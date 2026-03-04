import mongoose from 'mongoose';

export const connectMongo = async () => {
  // Uzimamo URI direktno iz environment promenljivih
  const uri = process.env.MONGO_URI;
  
  if (!uri) {
    console.warn('⚠️ MONGO_URI nije definisan u .env fajlu. MongoDB se neće povezati.');
    return;
  }

  try {
    await mongoose.connect(uri);
    console.log('Connected to MongoDB (Atlas)');
  } catch (error) {
    console.error('❌ Greška pri povezivanju na MongoDB:', error);
    throw error;
  }
};

export const disconnectMongo = async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
};