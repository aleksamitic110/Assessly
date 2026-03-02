import { Response } from 'express';
import { GradeStat } from '../models/GradeStat.js';

export const getExamStats = async (req: any, res: Response) => {
  const { examId } = req.params;

  try {
    const stats = await GradeStat.aggregate([
      // 1. Filtriramo samo ocene za traženi ispit
      { $match: { examId } },
      
      // 2. Grupišemo sve ocene u jedan rezultat i radimo matematiku
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
      
      // 3. Formatiramo izlaz (zaokružujemo decimale i računamo prosek)
      {
        $project: {
          _id: 0, // Ne treba nam ID u odgovoru
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

    // Ako niko još uvek nije ocenjen, vraćamo nule da frontend ne bi pukao
    if (stats.length === 0) {
      return res.json({
        totalStudents: 0,
        passedCount: 0,
        averageGrade: 0,
        passRate: 0
      });
    }

    res.json(stats[0]);
  } catch (error) {
    console.error('Greška pri dohvatanju statistike ispita:', error);
    res.status(500).json({ error: 'Failed to fetch exam statistics' });
  }
};