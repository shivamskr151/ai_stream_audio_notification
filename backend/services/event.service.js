const { prismaService } = require('../lib/prisma');
const { KafkaProducerService } = require('../lib/kafka');
const { getKafkaBrokers } = require('../config');

class EventService {
	constructor() {
		this.prisma = prismaService;
		this.kafkaEnabled = false;
		try {
			const brokers = getKafkaBrokers();
			this.kafkaEnabled = Array.isArray(brokers) && brokers.length > 0;
		} catch (_) {
			this.kafkaEnabled = false;
		}
		this.producer = this.kafkaEnabled ? new KafkaProducerService() : null;
		this.producerTopic = process.env.KAFKA_PRODUCER_TOPIC;
	}

	static serializeAbsoluteBBox(input) {
		if (!input || typeof input !== 'object') return {};
		let xywhString;
		if (Array.isArray(input.xywh) || typeof input.xywh === 'object') {
			xywhString = JSON.stringify(input.xywh);
		} else if (typeof input.xywh === 'string') {
			const trimmed = input.xywh.trim();
			if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
				try { xywhString = JSON.stringify(JSON.parse(trimmed)); } catch { xywhString = input.xywh; }
			} else {
				xywhString = input.xywh;
			}
		}

		let parametersString;
		if (input.parameters && (typeof input.parameters === 'object' || Array.isArray(input.parameters))) {
			parametersString = JSON.stringify(input.parameters);
		} else if (typeof input.parameters === 'string') {
			const trimmedP = input.parameters.trim();
			if ((trimmedP.startsWith('{') && trimmedP.endsWith('}')) || (trimmedP.startsWith('[') && trimmedP.endsWith(']'))) {
				try { parametersString = JSON.stringify(JSON.parse(trimmedP)); } catch { parametersString = input.parameters; }
			} else {
				parametersString = input.parameters;
			}
		}
		return {
			xywh: xywhString,
			class_name: input.class_name ?? undefined,
			confidence: typeof input.confidence === 'number' ? input.confidence : undefined,
			subcategory: input.subcategory ?? undefined,
			color: input.color ?? undefined,
			parameters: parametersString,
			anpr: input.anpr ?? undefined
		};
	}

	static parseAbsoluteBBox(output) {
		if (!output || typeof output !== 'object') return output;
		const parsed = { ...output };
		try {
			if (typeof parsed.xywh === 'string') parsed.xywh = JSON.parse(parsed.xywh);
		} catch {}
		try {
			if (typeof parsed.parameters === 'string') parsed.parameters = JSON.parse(parsed.parameters);
		} catch {}
		return parsed;
	}

	async list(params) {
		const { skip, take, page, pageSize, severity, sensor_id, status } = params || {};
		// Support page/pageSize as 1-based page index (page<=1 means first page).
		// Fallback to skip/take if page not provided
		const resolvedTakeRaw = page !== undefined ? (pageSize ?? 50) : (take ?? 50);
		const resolvedTake = Math.min(Number(resolvedTakeRaw), 200);
		const resolvedSkip = page !== undefined
			? (Math.max(1, Number(page)) - 1) * resolvedTake
			: Number(skip ?? 0);
		const rows = await this.prisma.event.findMany({
			skip: resolvedSkip,
			take: resolvedTake,
			where: {
				severity: severity || undefined,
				sensor_id: sensor_id || undefined,
				status: status || undefined
			},
			orderBy: { created_at: 'desc' },
			include: { absoluteBboxes: true }
		});
		return rows.map((e) => {
			const base = { ...e };
			const boxes = Array.isArray(e.absoluteBboxes)
				? e.absoluteBboxes.map((b) => EventService.parseAbsoluteBBox(b))
				: e.absoluteBboxes;
			delete base.absoluteBboxes;
			return { ...base, absolute_bbox: boxes };
		});
	}

	async getById(id) {
		const row = await this.prisma.event.findUnique({ where: { id }, include: { absoluteBboxes: true } });
		if (!row) return row;
		const base = { ...row };
		const boxes = Array.isArray(row.absoluteBboxes)
			? row.absoluteBboxes.map((b) => EventService.parseAbsoluteBBox(b))
			: row.absoluteBboxes;
		delete base.absoluteBboxes;
		return { ...base, absolute_bbox: boxes };
	}

	async create(data) {
		const { absolute_bbox, ...eventFields } = data || {};
		const created = await this.prisma.event.create({
			data: {
				...eventFields,
				absoluteBboxes: Array.isArray(absolute_bbox) && absolute_bbox.length
					? {
						create: absolute_bbox.map((b) => EventService.serializeAbsoluteBBox(b))
					}
					: undefined
			},
			include: { absoluteBboxes: true }
		});
		const base = { ...created };
		const boxes = Array.isArray(created.absoluteBboxes)
			? created.absoluteBboxes.map((b) => EventService.parseAbsoluteBBox(b))
			: created.absoluteBboxes;
		delete base.absoluteBboxes;
		return { ...base, absolute_bbox: boxes };
	}

	async update(id, data) {
		const { absolute_bbox, ...eventFields } = data || {};
		// For simplicity, only update event fields; boxes can be managed via separate endpoints if needed
		const updated = await this.prisma.event.update({ where: { id }, data: { ...eventFields } });
		// After update, publish to Kafka producer topic if configured
		try {
			if (this.kafkaEnabled && this.producer && this.producerTopic) {
				const result = await this.producer.send({
					topic: this.producerTopic,
					messages: [{
						key: String(id),
						value: JSON.stringify({
							type: 'EventUpdated',
							data: updated,
							timestamp: new Date().toISOString()
						})
					}]
				});
				console.log('Kafka producer result:', result);
			}
		} catch (_) {
			// Ignore producer errors to avoid failing the update path
		}
		return updated;
	}

	async remove(id) {
		return this.prisma.event.delete({ where: { id } });
	}

	async removeAll() {
		return this.prisma.event.deleteMany();
	}

	async getTotalCount(params) {
		const { severity, sensor_id, status } = params || {};
		const count = await this.prisma.event.count({
			where: {
				severity: severity || undefined,
				sensor_id: sensor_id || undefined,
				status: status || undefined
			}
		});
		return count;
	}
}

module.exports = { EventService };
