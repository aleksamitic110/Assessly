import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import { GradeStat } from './src/databases/mongodb/models/GradeStat.js';

const testStats = async () => {
  const uri = process.env.MONGO_URI;

  if (!uri) {
    console.error('❌ MONGO_URI nije pronadjen u .env fajlu!');
    process.exit(1);
  }

  try {
    console.log('⏳ Povezivanje na MongoDB Atlas...');
    await mongoose.connect(uri);
    console.log('✅ Povezano uspešno!\n');

    const testExamId = 'MOCK-EXAM-999';

    console.log('📝 Ubacujem 4 lažne ocene (Dve 10-ke, jedna 6-ica i jedna 5-ica)...');
    // Student 1-3 polažu, Student 4 pada (jer je 5)
    await GradeStat.insertMany([
      { examId: testExamId, studentId: 'S1', professorId: 'P1', gradeValue: 10, passed: true },
      { examId: testExamId, studentId: 'S2', professorId: 'P1', gradeValue: 10, passed: true },
      { examId: testExamId, studentId: 'S3', professorId: 'P1', gradeValue: 6, passed: true },
      { examId: testExamId, studentId: 'S4', professorId: 'P1', gradeValue: 5, passed: false }
    ]);
    console.log('✅ Ocene ubačene!\n');

    console.log('🔍 Računam statistiku ispita koristeći Aggregation Pipeline...');
    
    // OVO JE IDENTIČAN KOD IZ TVOG KONTROLERA
    const stats = await GradeStat.aggregate([
      { $match: { examId: testExamId } },
      {
        $group: {
          _id: null,
          totalStudents: { $sum: 1 },
          passedCount: {
            $sum: { $cond: [{ $eq: ['$passed', true] }, 1, 0] }
          },
          averageGrade: { $avg: '$gradeValue' }
        }
      },
      {
        $project: {
          _id: 0,
          totalStudents: 1,
          passedCount: 1,
          averageGrade: { $round: ['$averageGrade', 2] },
          passRate: {
            $round: [
              { $multiply: [{ $divide: ['$passedCount', '$totalStudents'] }, 100] },
              2
            ]
          }
        }
      }
    ]);

    console.log('📊 REZULTAT STATISTIKE:');
    console.log(stats[0]);
    console.log('\n(Očekivano: 4 studenta, 3 položila, prosek 7.75, prolaznost 75%)');

    console.log('\n🧹 Čistim test podatke...');
    await GradeStat.deleteMany({ examId: testExamId });
    console.log('✅ Baza očišćena!');

  } catch (error) {
    console.error('❌ Greška tokom testiranja:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Konekcija zatvorena.');
    process.exit(0);
  }
};

testStats();