import { prisma } from '@/lib/prisma';

type NullableNumber = number | null | undefined;

function toNumberOrNull(v: NullableNumber): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export type CreateFrameInput = {
  brand: string;
  model: string;
  size: string;
  color: string;
  material: string;
  price: number;
  ossImageUrl?: string | null;
  inventory?: number;
};

export async function listFrames() {
  return prisma.frame.findMany({ orderBy: [{ brand: 'asc' }, { model: 'asc' }] });
}

export async function createFrame(input: CreateFrameInput) {
  return prisma.frame.create({
    data: {
      brand: input.brand.trim(),
      model: input.model.trim(),
      size: input.size.trim(),
      color: input.color.trim(),
      material: input.material.trim(),
      price: Number(input.price),
      ossImageUrl: input.ossImageUrl?.trim() || null,
      inventory: Math.trunc(input.inventory ?? 0),
    },
  });
}

export type CreatePrescriptionInput = {
  customerName?: string | null;
  phone?: string | null;
  rightSph: number;
  rightCyl?: number | null;
  rightAxis?: number | null;
  leftSph: number;
  leftCyl?: number | null;
  leftAxis?: number | null;
  pd: number;
  ph?: number | null;
};

export async function listPrescriptions(phone?: string) {
  return prisma.prescription.findMany({
    where: phone?.trim() ? { phone: phone.trim() } : undefined,
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
}

export async function createPrescription(input: CreatePrescriptionInput) {
  return prisma.prescription.create({
    data: {
      customerName: input.customerName?.trim() || null,
      phone: input.phone?.trim() || null,
      rightSph: Number(input.rightSph),
      rightCyl: toNumberOrNull(input.rightCyl),
      rightAxis: input.rightAxis != null ? Math.trunc(input.rightAxis) : null,
      leftSph: Number(input.leftSph),
      leftCyl: toNumberOrNull(input.leftCyl),
      leftAxis: input.leftAxis != null ? Math.trunc(input.leftAxis) : null,
      pd: Number(input.pd),
      ph: toNumberOrNull(input.ph),
    },
  });
}

export type CreateOrderInput = {
  orderNo: string;
  prescriptionId: string;
  frameId?: string | null;
  lensType?: string | null;
  lensThickness?: number | null;
  totalPrice: number;
  status?: string;
};

export async function listOrders() {
  return prisma.order.findMany({
    include: { prescription: true, frame: true },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
}

export async function createOrder(input: CreateOrderInput) {
  return prisma.order.create({
    data: {
      orderNo: input.orderNo.trim(),
      prescriptionId: input.prescriptionId.trim(),
      frameId: input.frameId?.trim() || null,
      lensType: input.lensType?.trim() || null,
      lensThickness: toNumberOrNull(input.lensThickness),
      totalPrice: Number(input.totalPrice),
      status: input.status?.trim() || 'PAID',
    },
    include: { prescription: true, frame: true },
  });
}
