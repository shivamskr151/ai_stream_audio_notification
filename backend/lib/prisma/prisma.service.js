const { PrismaClient } = require('@prisma/client');

class PrismaService extends PrismaClient {
	async onModuleInit() {
		await this.$connect();
	}
}

const prismaService = new PrismaService();

module.exports = { PrismaService, prismaService };
