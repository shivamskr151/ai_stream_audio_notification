const { PrismaService, prismaService } = require('./prisma.service');

module.exports = {
	PrismaService,
	prismaService,
	prisma: prismaService
};