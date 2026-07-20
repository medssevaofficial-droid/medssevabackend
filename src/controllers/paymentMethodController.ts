import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const getPaymentMethods = async (req: Request, res: Response) => {
  try {
    const { mobile } = req.query;
    if (!mobile) {
      return res.status(400).json({ error: 'Mobile is required' });
    }

    const user = await prisma.user.findUnique({ where: { mobile: String(mobile) } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const methods = await prisma.paymentMethod.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' }
    });
    res.json(methods);
  } catch (error: any) {
    console.error('Error fetching payment methods:', error);
    res.status(500).json({ error: 'Failed to fetch payment methods', details: error.message });
  }
};

export const addPaymentMethod = async (req: Request, res: Response) => {
  try {
    const { mobile, bank, last4, holder, expiry, type } = req.body;
    
    if (!mobile || !bank || !last4 || !holder || !expiry) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const user = await prisma.user.findUnique({ where: { mobile: String(mobile) } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const method = await prisma.paymentMethod.create({
      data: {
        userId: user.id,
        bank,
        last4,
        holder,
        expiry,
        type: type || 'blue'
      }
    });

    res.status(201).json(method);
  } catch (error: any) {
    console.error('Error adding payment method:', error);
    res.status(500).json({ error: 'Failed to add payment method', details: error.message });
  }
};

export const removePaymentMethod = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.paymentMethod.delete({ where: { id } });
    res.json({ success: true });
  } catch (error: any) {
    console.error('Error removing payment method:', error);
    res.status(500).json({ error: 'Failed to remove payment method', details: error.message });
  }
};
