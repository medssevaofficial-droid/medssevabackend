import http from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import app from './app';
import { registerChatHandlers } from './socket/chatHandlers';
import os from 'os';

const prisma = new PrismaClient();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-medsseva-key';

const httpServer = http.createServer(app);

export const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Unauthorized'));
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { id: string; role?: string };
    const user = await prisma.user.findUnique({ where: { id: decoded.id } });
    if (!user) return next(new Error('User not found'));
    (socket as any).userId = decoded.id;
    (socket as any).userRole = decoded.role;
    (socket as any).userName = user.name;
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  registerChatHandlers(io, socket, prisma);
});

httpServer.listen(Number(PORT), '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  let localIP = 'localhost';
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        localIP = net.address;
      }
    }
  }
  console.log(`Backend server running on http://${localIP}:${PORT}`);
});