const { EventService } = require('../services/event.service');

const service = new EventService();

async function list(req, res, next) {
	try {
		const { page, pageSize, limit } = req.query || {};
		if (page !== undefined) {
			const p = Number(page);
			if (!Number.isFinite(p) || !Number.isInteger(p) || p < 1) {
				return res.status(400).json({ message: 'page must be an integer >= 1' });
			}
		}
		if (pageSize !== undefined) {
			const ps = Number(pageSize);
			if (!Number.isFinite(ps) || !Number.isInteger(ps) || ps < 1) {
				return res.status(400).json({ message: 'pageSize must be an integer >= 1' });
			}
		}
		if (limit !== undefined) {
			const l = Number(limit);
			if (!Number.isFinite(l) || !Number.isInteger(l) || l < 1) {
				return res.status(400).json({ message: 'limit must be an integer >= 1' });
			}
		}
		
		// Handle both regular list and pagination
		const queryParams = { ...req.query };
		if (limit && !pageSize) {
			queryParams.pageSize = limit;
		}
		
		const items = await service.list(queryParams);
		
		// For pagination endpoint, return additional metadata
		if (req.path.includes('/page')) {
			const totalCount = await service.getTotalCount(queryParams);
			const pageSize = Number(queryParams.pageSize) || 10;
			const currentPage = Number(queryParams.page) || 1;
			const totalPages = Math.ceil(totalCount / pageSize);
			
			res.json({ 
				events: items, 
				page: currentPage, 
				totalPages,
				totalCount,
				pageSize 
			});
		} else {
			res.json({ events: items });
		}
	} catch (err) {
		next(err);
	}
}

async function get(req, res, next) {
	try {
		const item = await service.getById(req.params.id);
		if (!item) return res.status(404).json({ message: 'Event not found' });
		res.json(item);
	} catch (err) {
		next(err);
	}
}

async function create(req, res, next) {
	try {
		const item = await service.create(req.body);
		res.status(201).json(item);
	} catch (err) {
		next(err);
	}
}

async function update(req, res, next) {
	try {
		const item = await service.update(req.params.id, req.body);
		res.json(item);
	} catch (err) {
		next(err);
	}
}

async function remove(req, res, next) {
	try {
		const response = await service.remove(req.params.id);
		res.json(response);
	} catch (err) {
		next(err);
	}
}

async function removeAll(req, res, next) {
	try {
		const response = await service.removeAll();
		console.log(response);
		res.json(response);
	} catch (err) {
		next(err);
	}
}

module.exports = { list, get, create, update, remove, removeAll };
