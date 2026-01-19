// src/controllers/examController.ts
import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { neo4jDriver } from '../neo4j.js';

export const createSubject = async (req: any, res: Response) => {
  const { name, description } = req.body;
  const professorId = req.user.id;
  const session = neo4jDriver.session();

  try {
    const id = uuidv4();
    const result = await session.run(
      `
      MATCH (p:User {id: $professorId})
      CREATE (s:Subject {id: $id, name: $name, description: $description})
      CREATE (p)-[:PREDAJE]->(s)
      RETURN s
      `,
      { professorId, id, name, description }
    );

    res.status(201).json(result.records[0].get('s').properties);
  } catch (error) {
    res.status(500).json({ error: "Error while creating subject" });
  } finally {
    await session.close();
  }
};

export const createExam = async (req: any, res: Response) => {
  const { subjectId, name, startTime, durationMinutes } = req.body;
  const session = neo4jDriver.session();

  try {
    const id = uuidv4();
    const result = await session.run(
      `
      MATCH (s:Subject {id: $subjectId})
      CREATE (e:Exam {id: $id, name: $name, startTime: $startTime, durationMinutes: $durationMinutes})
      CREATE (s)-[:SADRZI]->(e)
      RETURN e
      `,
      { subjectId, id, name, startTime, durationMinutes }
    );

    res.status(201).json(result.records[0].get('e').properties);
  } catch (error) {
    res.status(500).json({ error: "Greska pri kreiranju ispita" });
  } finally {
    await session.close();
  }
};

export const createTask = async (req: any, res: Response) => {
  const { examId, title, description, starterCode, testCases } = req.body;
  const session = neo4jDriver.session();

  try {
    const id = uuidv4();
    const result = await session.run(
      `
      MATCH (e:Exam {id: $examId})
      CREATE (t:Task {
        id: $id,
        title: $title,
        description: $description,
        starterCode: $starterCode,
        testCases: $testCases
      })
      CREATE (e)-[:IMA_ZADATAK]->(t)
      RETURN t
      `,
      { examId, id, title, description, starterCode, testCases: JSON.stringify(testCases) }
    );

    res.status(201).json(result.records[0].get('t').properties);
  } catch (error) {
    res.status(500).json({ error: "Greska pri kreiranju zadatka" });
  } finally {
    await session.close();
  }
};

export const getAvailableExams = async (req: any, res: Response) => {
  const session = neo4jDriver.session();

  try {
    const result = await session.run(
      `
      MATCH (s:Subject)-[]->(e:Exam)
      RETURN e, s
      ORDER BY e.startTime
      `
    );

    const exams = result.records.map(record => {
      const exam = record.get('e').properties;
      const subject = record.get('s').properties;
      return {
        id: exam.id,
        name: exam.name,
        startTime: exam.startTime,
        durationMinutes: Number(exam.durationMinutes),
        subjectId: subject.id,
        subjectName: subject.name
      };
    });

    res.json(exams);
  } catch (error) {
    res.status(500).json({ error: "Greska pri dohvatanju ispita" });
  } finally {
    await session.close();
  }
};

export const getExamById = async (req: any, res: Response) => {
  const { examId } = req.params;
  const session = neo4jDriver.session();

  try {
    const result = await session.run(
      `
      MATCH (s:Subject)-[:SADRZI]->(e:Exam {id: $examId})
      RETURN e, s
      `,
      { examId }
    );

    if (result.records.length === 0) {
      return res.status(404).json({ error: "Ispit nije pronadjen" });
    }

    const exam = result.records[0].get('e').properties;
    const subject = result.records[0].get('s').properties;

    res.json({
      id: exam.id,
      name: exam.name,
      startTime: exam.startTime,
      durationMinutes: Number(exam.durationMinutes),
      subjectId: subject.id,
      subjectName: subject.name
    });
  } catch (error) {
    res.status(500).json({ error: "Greska pri dohvatanju ispita" });
  } finally {
    await session.close();
  }
};

export const getProfessorSubjects = async (req: any, res: Response) => {
  const professorId = req.user.id;
  const session = neo4jDriver.session();

  try {
    const result = await session.run(
      `
      MATCH (p:User {id: $professorId})-[:PREDAJE]->(s:Subject)
      OPTIONAL MATCH (s)-[:SADRZI]->(e:Exam)
      RETURN s, collect(e) AS exams
      ORDER BY s.name
      `,
      { professorId }
    );

    const subjects = result.records.map(record => {
      const subject = record.get('s').properties;
      const exams = record.get('exams')
        .filter((exam: any) => exam)
        .map((exam: any) => ({
          id: exam.properties.id,
          name: exam.properties.name,
          startTime: exam.properties.startTime,
          durationMinutes: Number(exam.properties.durationMinutes),
          subjectId: subject.id,
          subjectName: subject.name
        }));

      return {
        id: subject.id,
        name: subject.name,
        description: subject.description,
        exams
      };
    });

    res.json(subjects);
  } catch (error) {
    res.status(500).json({ error: "Greska pri dohvatanju predmeta" });
  } finally {
    await session.close();
  }
};

export const getExamTasks = async (req: any, res: Response) => {
  const { examId } = req.params;
  const session = neo4jDriver.session();

  try {
    const result = await session.run(
      `
      MATCH (e:Exam {id: $examId})-[:IMA_ZADATAK]->(t:Task)
      RETURN t
      ORDER BY t.title
      `,
      { examId }
    );

    const tasks = result.records.map(record => {
      const task = record.get('t').properties;
      return {
        id: task.id,
        title: task.title,
        description: task.description,
        starterCode: task.starterCode,
        testCases: task.testCases
      };
    });

    res.json(tasks);
  } catch (error) {
    res.status(500).json({ error: "Greska pri dohvatanju zadataka" });
  } finally {
    await session.close();
  }
};
