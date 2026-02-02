import { io, Socket } from 'socket.io-client';

const getToken = () => localStorage.getItem('token');

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
