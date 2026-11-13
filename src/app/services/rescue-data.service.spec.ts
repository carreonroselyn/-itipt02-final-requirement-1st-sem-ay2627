import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RescueDataService } from './rescue-data.service';

const storageKeys = [
  'pawrescue.animals',
  'pawrescue.reportHistory',
  'pawrescue.adoptions',
  'pawrescue.user',
  'pawrescue.token',
];

describe('RescueDataService', () => {
  beforeEach(() => storageKeys.forEach((key) => localStorage.removeItem(key)));
  afterEach(() => vi.restoreAllMocks());

  it('does not overwrite pending demo reports with the public feed', async () => {
    const service = new RescueDataService();
    const pendingReport = service.animals().find((animal) => animal.status === 'Pending Rescue');
    expect(pendingReport).toBeDefined();
    const fetch = vi.spyOn(globalThis, 'fetch');

    await service.refresh();
    await service.refresh();

    expect(fetch).not.toHaveBeenCalled();
    expect(service.animals()).toContainEqual(pendingReport);
  });

  it('clears stale demo-admin role and reports when there is no server session', async () => {
    localStorage.setItem(
      'pawrescue.user',
      JSON.stringify({
        id: 'demo-admin',
        fullName: 'Rescue Team',
        email: 'admin@example.com',
        role: 'admin',
      }),
    );
    localStorage.setItem('pawrescue.animals', JSON.stringify([{ id: 'private-report' }]));
    const service = new RescueDataService();

    await service.refresh();

    expect(service.user().role).toBe('user');
    expect(service.animals().some((animal) => animal.id === 'private-report')).toBe(false);
  });

  it('does not save reports locally when the user is signed out', async () => {
    const service = new RescueDataService();
    const reportsBefore = service.animals();
    const historyBefore = service.reportHistory();

    await expect(
      service.createReport({
        reportedBy: 'Client',
        animalType: 'Dog',
        photoUrl: '',
        address: 'Main Street',
        latitude: null,
        longitude: null,
        conditionNotes: 'Needs help',
        medicalNotes: '',
        name: 'New dog rescue',
        age: null,
        gender: 'Unknown',
      }),
    ).rejects.toThrow('Mag-sign in bago magpadala ng report.');

    expect(service.animals()).toEqual(reportsBefore);
    expect(service.reportHistory()).toEqual(historyBefore);
  });
});
