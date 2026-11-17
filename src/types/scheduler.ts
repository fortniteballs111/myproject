export type EnergyLevel = 'high' | 'medium' | 'low';

export interface FixedBlock {
  id: string;
  title: string;
  /** Sunday = 0, Saturday = 6. Overnight blocks use two entries. */
  daysOfWeek: number[];
  startMinute: number;
  endMinute: number;
  category: string;
}

export interface Goal {
  id: string;
  title: string;
  totalMinutesRequired: number;
  completedMinutes: number;
  /** Calendar date (YYYY-MM-DD), inclusive. */
  deadlineISO: string;
  priority: 1 | 2 | 3 | 4 | 5;
  minSessionMinutes: number;
  maxSessionMinutes: number;
  preferredEnergy: EnergyLevel;
  color: string;
}

export interface EnergyWindow {
  startMinute: number;
  endMinute: number;
  level: EnergyLevel;
}

export interface ScheduledSession {
  id: string;
  goalId: string;
  title: string;
  dateISO: string;
  startMinute: number;
  endMinute: number;
  energyMatchScore: number;
  isLocked: boolean;
}
