import { io, Socket } from 'socket.io-client';

const getToken = () => localStorage.getItem('token');
const socketUrl = import.meta.env.VITE_SOCKET_URL?.trim();

const createSocket = () =>
  socketUrl
    ? io(socketUrl, {
        autoConnect: false,
        auth: (cb) => {
          cb({ token: getToken() });
        }
      })
    : io({
        autoConnect: false,
        auth: (cb) => {
          cb({ token: getToken() });
        }
      });

export const socket: Socket = createSocket();

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
