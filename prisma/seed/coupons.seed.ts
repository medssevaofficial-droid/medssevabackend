import { PrismaClient } from '@prisma/client';

export async function seedCoupons(prisma: PrismaClient) {
  console.log('🔄 Seeding coupons...');

  await prisma.coupon.createMany({
    skipDuplicates: true,
    data: [
      {
        code: 'FIRST100',
        description: 'Flat ₹100 off on first booking',
        discountType: 'FLAT',
        discountValue: 100,
        minOrderAmount: 299,
        usageLimit: 1000,
        isActive: true,
      },
      {
        code: 'SEVA20',
        description: '20% off, max ₹200 discount',
        discountType: 'PERCENTAGE',
        discountValue: 20,
        minOrderAmount: 499,
        maxDiscount: 200,
        usageLimit: 500,
        isActive: true,
      },
      {
        code: 'HEALTH50',
        description: 'Flat ₹50 off on any test',
        discountType: 'FLAT',
        discountValue: 50,
        minOrderAmount: 199,
        usageLimit: 2000,
        isActive: true,
      },
    ],
  });

  console.log('✅ Coupons seeded');
}