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
      CREATE (s)-[:SADRŽI]->(e)
      RETURN e
      `,
      { subjectId, id, name, startTime, durationMinutes }
    );

    res.status(201).json(result.records[0].get('e').properties);
  } catch (error) {
    res.status(500).json({ error: "Greška pri kreiranju ispita" });
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
    res.status(500).json({ error: "Greška pri kreiranju zadatka" });
  } finally {
    await session.close();
  }
};