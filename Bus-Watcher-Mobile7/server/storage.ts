import { db } from "./db";
import { 
  sessions, violations, violationTypes, users, authSessions, drivers,
  type Session, type InsertSession, 
  type Violation, type InsertViolation,
  type ViolationType, type InsertViolationType,
  type User, type AuthSession, type Driver
} from "@shared/schema";
import { eq, desc, and, gt, lt } from "drizzle-orm";

export interface DriverInfo {
  driverName: string;
  lastReportDate: Date;
}

export interface IStorage {
  // Users
  createUser(username: string): Promise<User>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserById(id: number): Promise<User | undefined>;
  
  // Auth Sessions
  createAuthSession(userId: number, token: string, expiresAt: Date): Promise<AuthSession>;
  getAuthSessionByToken(token: string): Promise<AuthSession | undefined>;
  deleteAuthSession(token: string): Promise<void>;
  deleteExpiredSessions(): Promise<void>;
  deleteUserSessions(userId: number): Promise<void>;
  
  // Bus Sessions
  createSession(session: InsertSession, userId: number): Promise<Session>;
  updateSession(id: number, userId: number, data: Partial<InsertSession>): Promise<Session | undefined>;
  endSession(id: number, userId: number, endTime: Date): Promise<Session | undefined>;
  getUserSession(id: number, userId: number): Promise<Session | undefined>;
  getUserSessions(userId: number): Promise<Session[]>;
  deleteSession(id: number, userId: number): Promise<boolean>;
  deleteAllUserSessions(userId: number): Promise<void>;
  
  // Violations
  createViolation(violation: InsertViolation): Promise<Violation>;
  getViolationById(id: number): Promise<Violation | undefined>;
  getViolations(sessionId: number): Promise<Violation[]>;
  deleteViolation(id: number): Promise<void>;
  
  // Violation Types
  createViolationType(type: InsertViolationType): Promise<ViolationType>;
  getViolationTypes(): Promise<ViolationType[]>;
  getViolationTypeByName(name: string): Promise<ViolationType | undefined>;
  deleteCustomViolationTypes(): Promise<void>;
  
  // Drivers (cross-user, persisted independently)
  getAllDrivers(): Promise<DriverInfo[]>;
  upsertDriver(driverName: string, reportDate: Date): Promise<void>;
  insertDriverIfNew(driverName: string, reportDate: Date): Promise<boolean>;
  updateDriverDate(driverName: string, newDate: Date): Promise<DriverInfo | undefined>;
  deleteDriverByName(driverName: string): Promise<void>;
  deleteAllDrivers(): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  // Users
  async createUser(username: string): Promise<User> {
    const [newUser] = await db.insert(users).values({
      username,
    }).returning();
    return newUser;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async getUserById(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  // Auth Sessions
  async createAuthSession(userId: number, token: string, expiresAt: Date): Promise<AuthSession> {
    const [session] = await db.insert(authSessions).values({
      userId,
      token,
      expiresAt,
    }).returning();
    return session;
  }

  async getAuthSessionByToken(token: string): Promise<AuthSession | undefined> {
    const [session] = await db.select().from(authSessions).where(
      and(eq(authSessions.token, token), gt(authSessions.expiresAt, new Date()))
    );
    return session;
  }

  async deleteAuthSession(token: string): Promise<void> {
    await db.delete(authSessions).where(eq(authSessions.token, token));
  }

  async deleteExpiredSessions(): Promise<void> {
    await db.delete(authSessions).where(lt(authSessions.expiresAt, new Date()));
  }

  async deleteUserSessions(userId: number): Promise<void> {
    await db.delete(authSessions).where(eq(authSessions.userId, userId));
  }

  // Bus Sessions
  async createSession(session: InsertSession, userId: number): Promise<Session> {
    const [newSession] = await db.insert(sessions).values({ ...session, userId }).returning();
    if (session.driverName && session.driverName.trim() !== '') {
      await this.upsertDriver(session.driverName, newSession.startTime);
    }
    return newSession;
  }
  
  async getUserSessions(userId: number): Promise<Session[]> {
    return await db.select().from(sessions).where(eq(sessions.userId, userId)).orderBy(desc(sessions.startTime));
  }

  async updateSession(id: number, userId: number, data: Partial<InsertSession>): Promise<Session | undefined> {
    const [updatedSession] = await db
      .update(sessions)
      .set(data)
      .where(and(eq(sessions.id, id), eq(sessions.userId, userId)))
      .returning();
    return updatedSession;
  }

  async endSession(id: number, userId: number, endTime: Date): Promise<Session | undefined> {
    const [updatedSession] = await db
      .update(sessions)
      .set({ endTime })
      .where(and(eq(sessions.id, id), eq(sessions.userId, userId)))
      .returning();
    return updatedSession;
  }

  async getUserSession(id: number, userId: number): Promise<Session | undefined> {
    const [session] = await db.select().from(sessions).where(
      and(eq(sessions.id, id), eq(sessions.userId, userId))
    );
    return session;
  }

  async deleteSession(id: number, userId: number): Promise<boolean> {
    const session = await this.getUserSession(id, userId);
    if (!session) return false;
    await db.delete(violations).where(eq(violations.sessionId, id));
    await db.delete(sessions).where(and(eq(sessions.id, id), eq(sessions.userId, userId)));
    return true;
  }

  async deleteAllUserSessions(userId: number): Promise<void> {
    const userSessions = await this.getUserSessions(userId);
    for (const session of userSessions) {
      await db.delete(violations).where(eq(violations.sessionId, session.id));
    }
    await db.delete(sessions).where(eq(sessions.userId, userId));
  }

  // Violations
  async createViolation(violation: InsertViolation): Promise<Violation> {
    const [newViolation] = await db.insert(violations).values(violation).returning();
    return newViolation;
  }

  async getViolationById(id: number): Promise<Violation | undefined> {
    const [violation] = await db.select().from(violations).where(eq(violations.id, id));
    return violation;
  }

  async getViolations(sessionId: number): Promise<Violation[]> {
    return await db
      .select()
      .from(violations)
      .where(eq(violations.sessionId, sessionId))
      .orderBy(desc(violations.timestamp));
  }

  async deleteViolation(id: number): Promise<void> {
    await db.delete(violations).where(eq(violations.id, id));
  }

  // Violation Types
  async createViolationType(type: InsertViolationType): Promise<ViolationType> {
    const [newType] = await db.insert(violationTypes).values(type).returning();
    return newType;
  }

  async getViolationTypes(): Promise<ViolationType[]> {
    return await db.select().from(violationTypes);
  }

  async getViolationTypeByName(name: string): Promise<ViolationType | undefined> {
    const [type] = await db.select().from(violationTypes).where(eq(violationTypes.name, name));
    return type;
  }

  async deleteCustomViolationTypes(): Promise<void> {
    await db.delete(violationTypes).where(eq(violationTypes.isDefault, false));
  }

  async getAllDrivers(): Promise<DriverInfo[]> {
    const result = await db
      .select()
      .from(drivers)
      .where(eq(drivers.isArchived, false))
      .orderBy(desc(drivers.lastReportDate));
    
    return result.map(r => ({
      driverName: r.driverName,
      lastReportDate: new Date(r.lastReportDate),
    }));
  }

  async upsertDriver(driverName: string, reportDate: Date): Promise<void> {
    if (!driverName || driverName.trim() === '') return;
    
    const existing = await db.select().from(drivers).where(eq(drivers.driverName, driverName));
    if (existing.length === 0) {
      await db.insert(drivers).values({ driverName, lastReportDate: reportDate });
    } else if (existing[0].lastReportDate < reportDate) {
      await db.update(drivers).set({ lastReportDate: reportDate }).where(eq(drivers.driverName, driverName));
    }
  }

  async insertDriverIfNew(driverName: string, reportDate: Date): Promise<boolean> {
    if (!driverName || driverName.trim() === '') return false;
    
    const existing = await db.select().from(drivers).where(eq(drivers.driverName, driverName));
    if (existing.length === 0) {
      await db.insert(drivers).values({ driverName, lastReportDate: reportDate });
      return true;
    }
    // If driver exists but is archived, don't unarchive (respect manual deletion)
    return false;
  }

  async updateDriverDate(driverName: string, newDate: Date): Promise<DriverInfo | undefined> {
    const [updated] = await db
      .update(drivers)
      .set({ lastReportDate: newDate })
      .where(eq(drivers.driverName, driverName))
      .returning();
    if (!updated) return undefined;
    return { driverName: updated.driverName, lastReportDate: updated.lastReportDate };
  }

  async deleteDriverByName(driverName: string): Promise<void> {
    await db.update(drivers).set({ isArchived: true }).where(eq(drivers.driverName, driverName));
  }

  async deleteAllDrivers(): Promise<void> {
    await db.delete(drivers);
  }
}

export const storage = new DatabaseStorage();
