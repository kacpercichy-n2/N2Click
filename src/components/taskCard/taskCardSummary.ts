import { snapHours } from '../../utils/time';
export function taskHoursRows(people: readonly { id: string; name: string }[], sold: ReadonlyMap<string, number>, dated: ReadonlyMap<string, number>) {
  return people.map(person => {
    const calendar = snapHours(dated.get(person.id) ?? 0);
    const total = snapHours(Math.max(calendar, sold.get(person.id) ?? 0));
    return { ...person, calendar, bin: snapHours(Math.max(0, total - calendar)), total };
  });
}
