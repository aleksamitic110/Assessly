// client/src/services/socket.ts
import { io, Socket } from 'socket.io-client';

// Citamo token iz localStorage-a
const getToken = () => localStorage.getItem('token');

// Kreiramo instancu, ali ne konektujemo se odmah (autoConnect: false)
export const socket: Socket = io('http://localhost:3000', {
  autoConnect: false,
  auth: (cb) => {
    cb({ token: getToken() });
  }
});

export const connectSocket = () => {
  if (!socket.connected) {
    socket.connect();
  }
};

export const disconnectSocket = () => {
  if (socket.connected) {
    socket.disconnect();
  }
};