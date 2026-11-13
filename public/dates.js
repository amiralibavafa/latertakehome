// Compare calendar dates in the viewer's timezone; due today stays yellow all day.
export function calendarDay(value, timeZone) {
  const date = new Date(value);
  if (value === null || value === undefined || Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const number = type => Number(parts.find(part => part.type === type).value);
  return Date.UTC(number('year'), number('month') - 1, number('day')) / 86_400_000;
}

export function deadline(todo, now = new Date(), timeZone) {
  const due = calendarDay(todo.dueAt, timeZone);
  const days = due === null ? null : due - calendarDay(now, timeZone);
  if (todo.done) return { tone: 'done', label: 'Done', days };
  if (days === null) return { tone: 'neutral', label: 'No due date', days };
  if (days < 0) return { tone: 'overdue', label: `${Math.abs(days)}d overdue`, days };
  if (days === 0) return { tone: 'soon', label: 'Due today', days };
  if (days < 5) return { tone: 'soon', label: `Due in ${days}d`, days };
  return { tone: 'safe', label: `Due in ${days}d`, days };
}
