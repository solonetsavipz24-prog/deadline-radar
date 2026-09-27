import { describe, expect, it } from 'vitest'
import {
  groupTasks, isTask, nextOccurrence, parseTaskBackup, sortTasks, toDatabaseTask,
} from './taskUtils'
import type { Task } from './taskUtils'

const task = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1',
  title: 'Лабораторна',
  subject: 'Програмування',
  due: '2026-09-28T10:00:00.000Z',
  description: '',
  link: '',
  status: 'todo',
  priority: 'medium',
  repeat: 'none',
  repeatDay: null,
  remind: false,
  ...overrides,
})

describe('task validation and backups', () => {
  it('accepts valid tasks and rejects invalid required fields', () => {
    expect(isTask(task())).toBe(true)
    expect(isTask({ ...task(), due: 'not a date' })).toBe(false)
    expect(isTask({ ...task(), status: 'blocked' })).toBe(false)
    expect(isTask({ ...task(), title: '   ' })).toBe(false)
    expect(isTask({ ...task(), link: 'javascript:alert(1)' })).toBe(false)
  })

  it('imports both legacy array backups and versioned backup objects', () => {
    expect(parseTaskBackup(JSON.stringify([task()]))).toEqual([task()])
    expect(parseTaskBackup(JSON.stringify({ version: 1, tasks: [task()] }))).toEqual([task()])
    expect(parseTaskBackup(JSON.stringify([{ id: 'old', title: 'Завдання', subject: 'Історія', due: '2026-10-01T10:00', status: 'todo' }]))[0]).toMatchObject({
      id: 'old', priority: 'medium', repeat: 'none', repeatDay: null, remind: false, description: '', link: '',
    })
    expect(() => parseTaskBackup('{"tasks":[{"title":"broken"}]}')).toThrow('невірний формат')
  })

  it('converts local task fields to the Supabase schema and UTC timestamp', () => {
    expect(toDatabaseTask(task())).toMatchObject({
      title: 'Лабораторна',
      due_at: '2026-09-28T10:00:00.000Z',
      repeat_rule: 'none',
      repeat_day: null,
      remind: false,
    })
  })
})

describe('task planning', () => {
  it('groups overdue, today, this-week and later tasks using local calendar dates', () => {
    const groups = groupTasks([
      task({ id: 'late', due: '2026-09-26T10:00:00' }),
      task({ id: 'today', due: '2026-09-28T10:00:00' }),
      task({ id: 'week', due: '2026-09-30T10:00:00' }),
      task({ id: 'later', due: '2026-10-10T10:00:00' }),
      task({ id: 'done-old', due: '2026-09-20T10:00:00', status: 'done' }),
    ], new Date(2026, 8, 28, 12))

    expect(groups.overdue.map(({ id }) => id)).toEqual(['late'])
    expect(groups.today.map(({ id }) => id)).toEqual(['today'])
    expect(groups.week.map(({ id }) => id)).toEqual(['week'])
    expect(groups.later.map(({ id }) => id)).toEqual(['later', 'done-old'])
  })

  it('advances repeated tasks and clamps monthly repeats to month end', () => {
    expect(nextOccurrence('2026-09-27T10:00:00.000Z', 'daily')).toBe('2026-09-28T10:00:00.000Z')
    expect(nextOccurrence('2026-09-27T10:00:00.000Z', 'weekly')).toBe('2026-10-04T10:00:00.000Z')
    const february = new Date(nextOccurrence('2024-01-31T10:00:00.000Z', 'monthly', 31)!)
    const march = new Date(nextOccurrence(february.toISOString(), 'monthly', 31)!)
    expect(february.getDate()).toBe(29)
    expect(march.getDate()).toBe(31)
    expect(march.getHours()).toBe(february.getHours())
    expect(nextOccurrence('2026-09-27T10:00:00.000Z', 'none')).toBeNull()
  })

  it('includes the entire Sunday in the current week', () => {
    const groups = groupTasks([
      task({ id: 'sunday', due: '2026-09-27T23:59:00' }),
      task({ id: 'monday', due: '2026-09-28T00:00:00' }),
    ], new Date(2026, 8, 21, 12))
    expect(groups.week.map(({ id }) => id)).toEqual(['sunday'])
    expect(groups.later.map(({ id }) => id)).toEqual(['monday'])
  })

  it('sorts by nearest deadline or priority then nearest deadline', () => {
    const tasks = [
      task({ id: 'later', due: '2026-10-01T10:00:00Z', priority: 'high' }),
      task({ id: 'soon-low', due: '2026-09-28T10:00:00Z', priority: 'low' }),
      task({ id: 'soon-high', due: '2026-09-28T11:00:00Z', priority: 'high' }),
    ]
    expect(sortTasks(tasks, 'due').map(({ id }) => id)).toEqual(['soon-low', 'soon-high', 'later'])
    expect(sortTasks(tasks, 'priority').map(({ id }) => id)).toEqual(['soon-high', 'later', 'soon-low'])
    expect(sortTasks(tasks, 'newest').map(({ id }) => id)).toEqual(['later', 'soon-high', 'soon-low'])
  })
})
