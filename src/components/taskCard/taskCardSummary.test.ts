import { describe, expect, it } from 'vitest';
import { taskHoursRows } from './taskCardSummary';
describe('taskHoursRows', () => {
  it('derives calendar, bin and reconciled total per assigned person', () => {
    expect(taskHoursRows([{id: 'a', name: 'Ola'}, {id: 'b', name: 'Kasia'}], new Map([['a', 6], ['b', 1]]), new Map([['a', 4], ['b', 2.25]]))).toEqual([
      {id: 'a', name: 'Ola', calendar: 4, bin: 2, total: 6},
      {id: 'b', name: 'Kasia', calendar: 2.25, bin: 0, total: 2.25},
    ]);
  });
  it('keeps zero-hour assignees visible and ignores unrelated people', () => {
    expect(taskHoursRows([{id: 'a', name: 'Ola'}], new Map([['other', 9]]), new Map())).toEqual([{id: 'a', name: 'Ola', calendar: 0, bin: 0, total: 0}]);
  });
});
