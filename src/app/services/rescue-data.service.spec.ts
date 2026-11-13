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

    expect(fetch).not.toHaveBeenCalled();
    expect(service.animals()).toContainEqual(pendingReport);
  });

  it('keeps submission and rescue status updates in report history', async () => {
    const service = new RescueDataService();
    await service.createReport({
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
    });
    const report = service.animals()[0];

    expect(service.reportHistory()[0]).toMatchObject({
      animalId: report.id,
      eventType: 'submitted',
      status: 'Pending Rescue',
    });

    await service.updateAnimal(report.id, { status: 'Rescued / In Transit' });

    expect(service.reportHistory()[0]).toMatchObject({
      animalId: report.id,
      eventType: 'status_changed',
      status: 'Rescued / In Transit',
    });
  });
});
