import express from 'express';
import cors from 'cors';
import categoryRoutes from './routes/categoryRoutes';
import bookingRoutes from './routes/bookingRoutes';
import authRoutes from './routes/authRoutes';
import addressRoutes from './routes/addressRoutes';
import testRoutes from './routes/testRoutes';
import userRoutes from './routes/userRoutes';
import cityRoutes from './routes/cityRoutes';
import paymentMethodRoutes from './routes/paymentMethodRoutes';
import packageRoutes from './routes/packageRoutes';
import reportRoutes from './routes/reportRoutes';
import roleRoutes from './routes/roleRoutes';
import adminUserRoutes from './routes/adminUserRoutes';
import branchRoutes from './routes/branchRoutes';
import partnerRoutes from './routes/partnerRoutes';
import prescriptionRoutes from './routes/prescriptionRoutes';
import chatRoutes from './routes/chatRoutes';
import analyticsRoutes from './routes/analyticsRoutes';
import sampleRoutes from './routes/sampleRoutes';
import financeRoutes from './routes/financeRoutes';
import couponRoutes from './routes/couponRoutes';
import inventoryRoutes from './routes/inventoryRoutes';
import cmsRoutes from './routes/cmsRoutes';
import notificationRoutes from './routes/notificationRoutes';
import { globalLimiter } from './middlewares/rateLimiter';
import { errorHandler } from './middlewares/errorHandler';
import { apiRequestLogger } from './middlewares/apiLogger';
import auditRoutes from './routes/auditRoutes';
import settingsRoutes from './routes/settingsRoutes';

const app = express();

app.set('trust proxy', 1);
app.use(cors());

const rawBodyMiddleware = express.raw({ type: 'application/json' });
const parseRawBody = (req: any, res: any, next: any) => {
  req.rawBody = req.body.toString('utf8');
  req.body = JSON.parse(req.rawBody);
  next();
};
app.use('/api/bookings/webhook/razorpay', rawBodyMiddleware, parseRawBody);
app.use('/api/finance/webhook/razorpay', rawBodyMiddleware, parseRawBody);

app.use(express.json());

app.use(apiRequestLogger);
app.use('/api', globalLimiter);

// Routes
app.use('/api/categories', categoryRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/addresses', addressRoutes);
app.use('/api/tests', testRoutes);
app.use('/api/users', userRoutes);
app.use('/api/cities', cityRoutes);
app.use('/api/payment-methods', paymentMethodRoutes);
app.use('/api/packages', packageRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/admin-users', adminUserRoutes);
app.use('/api/branches', branchRoutes);
app.use('/api/partner', partnerRoutes);
app.use('/api/prescriptions', prescriptionRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/samples', sampleRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/cms', cmsRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/admin/audit-logs', auditRoutes);
app.use('/api/settings', settingsRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Global Error Handler
app.use(errorHandler);

export default app;
