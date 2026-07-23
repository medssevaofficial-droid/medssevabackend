import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import Razorpay from 'razorpay';
import crypto from 'crypto';



const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID!,
  key_secret: process.env.RAZORPAY_KEY_SECRET!,
});

const getIp = (req: Request): string =>
  (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '';

export const getPaymentSummary = async (req: Request, res: Response) => {
  try {
    const [totalCaptured, totalPending, totalRefunded, totalSettlementsPending] = await Promise.all([
      prisma.payment.aggregate({ where: { status: 'CAPTURED' }, _sum: { amount: true } }),
      prisma.payment.aggregate({ where: { status: 'PENDING' }, _sum: { amount: true } }),
      prisma.refund.aggregate({ where: { status: 'COMPLETED' }, _sum: { amount: true } }),
      prisma.settlement.aggregate({ where: { status: 'PENDING' }, _sum: { commissionAmount: true } }),
    ]);

    res.json({
      totalCollected: totalCaptured._sum.amount || 0,
      totalPending: totalPending._sum.amount || 0,
      totalRefunded: totalRefunded._sum.amount || 0,
      pendingSettlements: totalSettlementsPending._sum.commissionAmount || 0,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch payment summary', details: error.message });
  }
};

export const getPayments = async (req: Request, res: Response) => {
  try {
    const { page = '1', limit = '50', status, from, to } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

    const where: any = {};
    if (status) where.status = status;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from as string);
      if (to) where.createdAt.lte = new Date(to as string);
    }

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        skip,
        take: parseInt(limit as string),
        orderBy: { createdAt: 'desc' },
        include: {
          booking: {
            select: {
              bookingCode: true,
              patientName: true,
              branch: { select: { name: true } },
            },
          },
        },
      }),
      prisma.payment.count({ where }),
    ]);

    res.json({ payments, total, page: parseInt(page as string), limit: parseInt(limit as string) });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch payments', details: error.message });
  }
};

export const getPaymentById = async (req: Request, res: Response) => {
  try {
    const payment = await prisma.payment.findUnique({
      where: { id: req.params.id },
      include: {
        booking: { select: { bookingCode: true, patientName: true, patientMobile: true } },
        refunds: true,
        financeAuditLogs: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    res.json(payment);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch payment', details: error.message });
  }
};

export const createRazorpayOrder = async (req: Request, res: Response) => {
  try {
    const { bookingId } = req.body;
    if (!bookingId) return res.status(400).json({ error: 'bookingId is required' });

    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    const existing = await prisma.payment.findUnique({ where: { bookingId } });
    if (existing?.status === 'CAPTURED') {
      return res.status(400).json({ error: 'Payment already completed for this booking' });
    }

    const order = await razorpay.orders.create({
      amount: Math.round(booking.totalPaid * 100),
      currency: 'INR',
      receipt: booking.bookingCode,
    });

    const invoiceNumber = `INV-${Date.now()}-${booking.bookingCode}`;

    const payment = existing
      ? await prisma.payment.update({
          where: { bookingId },
          data: { razorpayOrderId: order.id, status: 'PENDING' },
        })
      : await prisma.payment.create({
          data: {
            bookingId,
            razorpayOrderId: order.id,
            amount: booking.totalPaid,
            invoiceNumber,
            status: 'PENDING',
          },
        });

    await prisma.financeAuditLog.create({
      data: {
        action: 'PAYMENT_ORDER_CREATED',
        module: 'PAYMENT',
        paymentId: payment.id,
        bookingRef: booking.bookingCode,
        performedById: (req as any).user?.id,
        performedByRole: (req as any).user?.role,
        ipAddress: getIp(req),
        details: { orderId: order.id, amount: booking.totalPaid },
      },
    });

  res.json({ orderId: order.id, amount: booking.totalPaid, currency: 'INR', keyId: process.env.RAZORPAY_KEY_ID, paymentId: payment.id, invoiceNumber });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create Razorpay order', details: error.message });
  }
};

export const verifyPayment = async (req: Request, res: Response) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, bookingId } = req.body;

    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!)
      .update(body)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ error: 'Invalid payment signature' });
    }

    const paymentDetails = await razorpay.payments.fetch(razorpay_payment_id);

    const payment = await prisma.payment.update({
      where: { bookingId },
      data: {
        razorpayPaymentId: razorpay_payment_id,
        razorpaySignature: razorpay_signature,
        status: 'CAPTURED',
        method: String(paymentDetails.method),
        paidAt: new Date(),
        webhookVerified: true,
      },
    });

    await prisma.booking.update({
      where: { id: bookingId },
      data: { paymentStatus: 'SUCCESS', paymentId: razorpay_payment_id },
    });

    await prisma.financeAuditLog.create({
      data: {
        action: 'PAYMENT_CAPTURED',
        module: 'PAYMENT',
        paymentId: payment.id,
        txReference: razorpay_payment_id,
        performedById: (req as any).user?.id,
        performedByRole: (req as any).user?.role,
        ipAddress: getIp(req),
        details: { razorpay_order_id, razorpay_payment_id },
      },
    });

    res.json({ success: true, payment });
  } catch (error: any) {
    res.status(500).json({ error: 'Payment verification failed', details: error.message });
  }
};

export const handleRazorpayWebhook = async (req: Request, res: Response) => {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET!;
    const signature = req.headers['x-razorpay-signature'] as string;
    const body = (req as any).rawBody || JSON.stringify(req.body);

    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(body)
      .digest('hex');

    if (expectedSignature !== signature) {
      return res.status(400).json({ error: 'Invalid webhook signature' });
    }

    const event = req.body;

if (event.event === 'payment.captured' || event.event === 'payment.authorized') {
      const p = event.payload.payment.entity;
      await prisma.payment.updateMany({
        where: { razorpayOrderId: p.order_id },
        data: {
          razorpayPaymentId: p.id,
          status: 'CAPTURED',
          method: p.method,
          paidAt: new Date(p.created_at * 1000),
          webhookVerified: true,
        },
      });
      const payment = await prisma.payment.findFirst({ where: { razorpayOrderId: p.order_id } });
      if (payment) {
        await prisma.booking.update({
          where: { id: payment.bookingId },
          data: { paymentStatus: 'SUCCESS', paymentId: p.id },
        });
      }
    }

    if (event.event === 'payment.failed') {
      const p = event.payload.payment.entity;
      await prisma.payment.updateMany({
        where: { razorpayOrderId: p.order_id },
        data: { status: 'FAILED', webhookVerified: true },
      });
    }

    if (event.event === 'order.paid') {
      const o = event.payload.order.entity;
      const payment = await prisma.payment.findFirst({ where: { razorpayOrderId: o.id } });
      if (payment && payment.status !== 'CAPTURED') {
        await prisma.payment.update({
          where: { id: payment.id },
          data: { status: 'CAPTURED', webhookVerified: true },
        });
        await prisma.booking.update({
          where: { id: payment.bookingId },
          data: { paymentStatus: 'SUCCESS' },
        });
      }
    }

    if (event.event === 'refund.created' || event.event === 'refund.processed') {
      const r = event.payload.refund.entity;
      await prisma.refund.updateMany({
        where: { razorpayRefundId: r.id },
        data: { status: 'COMPLETED', processedAt: new Date(r.created_at * 1000) },
      });
    }

    if (event.event === 'payment_link.paid') {
      const p = event.payload.payment.entity;
      const payment = await prisma.payment.findFirst({ where: { razorpayOrderId: p.order_id } });
      if (payment && payment.status !== 'CAPTURED') {
        await prisma.payment.updateMany({
          where: { razorpayOrderId: p.order_id },
          data: {
            razorpayPaymentId: p.id,
            status: 'CAPTURED',
            method: p.method,
            paidAt: new Date(p.created_at * 1000),
            webhookVerified: true,
          },
        });
        await prisma.booking.update({
          where: { id: payment.bookingId },
          data: { paymentStatus: 'SUCCESS', paymentId: p.id },
        });
      }
    }

    res.json({ received: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Webhook processing failed', details: error.message });
  }
};

export const getRefunds = async (req: Request, res: Response) => {
  try {
    const { status } = req.query;
    const where: any = {};
    if (status) where.status = status;

    const refunds = await prisma.refund.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        payment: {
          include: {
            booking: { select: { bookingCode: true, patientName: true } },
          },
        },
      },
    });

    res.json(refunds);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch refunds', details: error.message });
  }
};

export const requestRefund = async (req: Request, res: Response) => {
  try {
    const { paymentId, amount, reason, approvalNotes } = req.body;
    if (!paymentId || !amount || !reason) {
      return res.status(400).json({ error: 'paymentId, amount, and reason are required' });
    }

    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { refunds: { where: { status: { in: ['PENDING', 'APPROVED', 'COMPLETED'] } } } },
    });

    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    if (payment.status !== 'CAPTURED') return res.status(400).json({ error: 'Only captured payments can be refunded' });

    const totalRefunded = payment.refunds.reduce((s, r) => s + r.amount, 0);
    if (totalRefunded + amount > payment.amount) {
      return res.status(400).json({ error: 'Refund amount exceeds payment amount' });
    }

    const refund = await prisma.refund.create({
      data: {
        paymentId,
        bookingId: payment.bookingId,
        amount,
        reason,
        approvalNotes,
        status: 'PENDING',
        requestedById: (req as any).user?.id,
      },
    });

    await prisma.financeAuditLog.create({
      data: {
        action: 'REFUND_REQUESTED',
        module: 'REFUND',
        paymentId,
        refundId: refund.id,
        bookingRef: payment.bookingId,
        performedById: (req as any).user?.id,
        performedByRole: (req as any).user?.role,
        ipAddress: getIp(req),
        details: { amount, reason },
      },
    });

    res.status(201).json(refund);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to request refund', details: error.message });
  }
};

export const approveRefund = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const refund = await prisma.refund.findUnique({ where: { id }, include: { payment: true } });
    if (!refund) return res.status(404).json({ error: 'Refund not found' });
    if (refund.status !== 'PENDING') return res.status(400).json({ error: 'Only pending refunds can be approved' });

    await prisma.refund.update({ where: { id }, data: { status: 'APPROVED', approvedById: (req as any).user?.id } });

    let gatewayRefundId: string | null = null;

    if (refund.payment.razorpayPaymentId) {
      try {
        const gatewayRefund = await razorpay.payments.refund(refund.payment.razorpayPaymentId, {
          amount: Math.round(refund.amount * 100),
          notes: { reason: refund.reason },
        });
        gatewayRefundId = (gatewayRefund as any).id;
      } catch (gatewayErr: any) {
        await prisma.refund.update({
          where: { id },
          data: { status: 'FAILED', gatewayResponse: { error: gatewayErr.message } },
        });
        return res.status(502).json({ error: 'Gateway refund failed', details: gatewayErr.message });
      }
    }

    const updated = await prisma.refund.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        razorpayRefundId: gatewayRefundId,
        processedAt: new Date(),
        gatewayResponse: { refundId: gatewayRefundId },
      },
    });

    const totalRefunded = (
      await prisma.refund.aggregate({
        where: { paymentId: refund.paymentId, status: 'COMPLETED' },
        _sum: { amount: true },
      })
    )._sum.amount || 0;

    const newPaymentStatus = totalRefunded >= refund.payment.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
    await prisma.payment.update({ where: { id: refund.paymentId }, data: { status: newPaymentStatus } });
    await prisma.booking.update({
      where: { id: refund.bookingId },
      data: { paymentStatus: newPaymentStatus === 'REFUNDED' ? 'REFUNDED' : 'SUCCESS' },
    });

    await prisma.financeAuditLog.create({
      data: {
        action: 'REFUND_COMPLETED',
        module: 'REFUND',
        paymentId: refund.paymentId,
        refundId: id,
        txReference: gatewayRefundId || undefined,
        performedById: (req as any).user?.id,
        performedByRole: (req as any).user?.role,
        ipAddress: getIp(req),
        details: { amount: refund.amount, gatewayRefundId },
      },
    });

    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to approve refund', details: error.message });
  }
};

export const rejectRefund = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const refund = await prisma.refund.findUnique({ where: { id } });
    if (!refund) return res.status(404).json({ error: 'Refund not found' });
    if (refund.status !== 'PENDING') return res.status(400).json({ error: 'Only pending refunds can be rejected' });

    const updated = await prisma.refund.update({
      where: { id },
      data: { status: 'REJECTED', approvedById: (req as any).user?.id, approvalNotes: reason },
    });

    await prisma.financeAuditLog.create({
      data: {
        action: 'REFUND_REJECTED',
        module: 'REFUND',
        refundId: id,
        performedById: (req as any).user?.id,
        performedByRole: (req as any).user?.role,
        ipAddress: getIp(req),
        details: { reason },
      },
    });

    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to reject refund', details: error.message });
  }
};

export const getSettlements = async (req: Request, res: Response) => {
  try {
    const { status } = req.query;
    const where: any = {};
    if (status) where.status = status;
    const settlements = await prisma.settlement.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    res.json(settlements);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch settlements', details: error.message });
  }
};

export const generateSettlements = async (req: Request, res: Response) => {
  try {
    const { periodStart, periodEnd, franchiseId, franchiseName, commissionRate = 15 } = req.body;
    if (!periodStart || !periodEnd || !franchiseName) {
      return res.status(400).json({ error: 'periodStart, periodEnd, and franchiseName are required' });
    }

    const where: any = {
      paymentStatus: 'SUCCESS',
      createdAt: { gte: new Date(periodStart), lte: new Date(periodEnd) },
    };
    if (franchiseId) where.branchId = franchiseId;

    const bookings = await prisma.booking.findMany({ where, select: { totalPaid: true } });
    const totalBusiness = bookings.reduce((s, b) => s + b.totalPaid, 0);
    const commissionAmount = (totalBusiness * commissionRate) / 100;
    const taxOnCommission = commissionAmount * 0.18;
    const netPayable = commissionAmount - taxOnCommission;

    const period = `${new Date(periodStart).toLocaleDateString('en-IN')} - ${new Date(periodEnd).toLocaleDateString('en-IN')}`;

    const settlement = await prisma.settlement.create({
      data: {
        franchiseId,
        franchiseName,
        period,
        periodStart: new Date(periodStart),
        periodEnd: new Date(periodEnd),
        totalBusiness,
        commissionRate,
        commissionAmount,
        taxOnCommission,
        netPayable,
        status: 'PENDING',
      },
    });

    await prisma.financeAuditLog.create({
      data: {
        action: 'SETTLEMENT_GENERATED',
        module: 'SETTLEMENT',
        settlementId: settlement.id,
        performedById: (req as any).user?.id,
        performedByRole: (req as any).user?.role,
        ipAddress: getIp(req),
        details: { totalBusiness, commissionAmount, period },
      },
    });

    res.status(201).json(settlement);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to generate settlement', details: error.message });
  }
};

export const processSettlement = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const settlement = await prisma.settlement.findUnique({ where: { id } });
    if (!settlement) return res.status(404).json({ error: 'Settlement not found' });
    if (settlement.status !== 'PENDING' && settlement.status !== 'APPROVED') {
      return res.status(400).json({ error: 'Settlement cannot be processed in its current state' });
    }

    const payoutRef = `PAY-${settlement.settlementRef}-${Date.now()}`;

    const updated = await prisma.settlement.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        payoutReference: payoutRef,
        processedAt: new Date(),
        approvedById: (req as any).user?.id,
      },
    });

    await prisma.financeAuditLog.create({
      data: {
        action: 'SETTLEMENT_PROCESSED',
        module: 'SETTLEMENT',
        settlementId: id,
        txReference: payoutRef,
        performedById: (req as any).user?.id,
        performedByRole: (req as any).user?.role,
        ipAddress: getIp(req),
        details: { netPayable: settlement.netPayable, payoutRef },
      },
    });

    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to process settlement', details: error.message });
  }
};