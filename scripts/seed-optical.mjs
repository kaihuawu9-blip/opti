import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const frameCount = await prisma.frame.count();
  if (frameCount === 0) {
    await prisma.frame.createMany({
      data: [
        {
          brand: 'ZEISS',
          model: 'Z-Classic 52',
          size: '52-18-140',
          color: '枪灰',
          material: '钛',
          price: 980,
          ossImageUrl: 'https://example-bucket.oss-cn-hangzhou.aliyuncs.com/frames/zeiss-z52.jpg',
          inventory: 12,
        },
        {
          brand: 'Essilor',
          model: 'AirLite 50',
          size: '50-19-145',
          color: '亮黑',
          material: '板材',
          price: 680,
          ossImageUrl: 'https://example-bucket.oss-cn-hangzhou.aliyuncs.com/frames/essilor-airlite-50.jpg',
          inventory: 20,
        },
      ],
    });
  }

  let prescription = await prisma.prescription.findFirst({ where: { phone: '13800138000' } });
  if (!prescription) {
    prescription = await prisma.prescription.create({
      data: {
        customerName: '测试客户',
        phone: '13800138000',
        rightSph: -4.5,
        rightCyl: -0.75,
        rightAxis: 175,
        leftSph: -4.25,
        leftCyl: -0.5,
        leftAxis: 5,
        pd: 62,
        ph: 20,
      },
    });
  }

  const frame = await prisma.frame.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!frame) throw new Error('seed failed: frame not found');

  const orderNo = `SO-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-0001`;
  const exists = await prisma.order.findUnique({ where: { orderNo } });
  if (!exists) {
    await prisma.order.create({
      data: {
        orderNo,
        prescriptionId: prescription.id,
        frameId: frame.id,
        lensType: '1.67 防蓝光',
        lensThickness: 2.34,
        totalPrice: 1680,
        status: 'PAID',
      },
    });
  }

  console.log('optical seed completed');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
