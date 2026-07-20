import { z } from 'zod';

export const createBookingSchema = z.object({
  tests: z.array(z.object({
    id: z.string().optional(),
    testId: z.string().optional(),
    name: z.string().optional(),
    price: z.union([z.string(), z.number()]).optional(),
    discountedPrice: z.union([z.string(), z.number()]).optional()
  })).optional(),
  scheduledDate: z.string(),
  scheduledSlot: z.string().optional(),
  totalPaid: z.union([z.string(), z.number()]).optional(),
  patientName: z.string().min(1, 'Patient name is required'),
mobile: z.string().min(10, 'Valid mobile number is required').optional(),
  collectionMode: z.enum(['home', 'lab']).optional(),
  addressId: z.string().nullable().optional(),
  razorpay_payment_id: z.string().optional(),
  razorpay_order_id: z.string().optional(),
  razorpay_signature: z.string().optional(),
  paymentMethod: z.string().optional()
});

export const createReportSchema = z.object({
  bookingId: z.string().uuid('Valid booking ID is required'),
  testName: z.string().min(1, 'Test name is required'),
  clinicalNotes: z.string().optional(),
  parameters: z.array(z.object({
    parameterId: z.string().optional(),
    parameterName: z.string().min(1, 'Parameter name is required'),
    observedValue: z.string().min(1, 'Observed value is required'),
    unit: z.string().optional(),
    referenceRange: z.string().optional(),
    isAbnormal: z.boolean().optional()
  })).min(1, 'At least one parameter is required')
});
