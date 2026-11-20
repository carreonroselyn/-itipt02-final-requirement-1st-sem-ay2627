import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
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
  beforeEach(() => {
    storageKeys.forEach((key) => localStorage.removeItem(key));
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
  });
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('does not overwrite pending demo reports with the public feed', async () => {
    const service = TestBed.inject(RescueDataService);
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
    const service = TestBed.inject(RescueDataService);

    await service.refresh();

    expect(service.user().role).toBe('user');
    expect(service.animals().some((animal) => animal.id === 'private-report')).toBe(false);
  });

  it('does not save reports locally when the user is signed out', async () => {
    const service = TestBed.inject(RescueDataService);
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

  it('deletes an animal and its related adoption and report history records', async () => {
    const service = TestBed.inject(RescueDataService);
    const animalId = service.adoptions()[0].animalId;
    service.reportHistory.set([
      {
        id: 'history-1',
        animalId,
        reportedBy: 'Mika Santos',
        animalName: 'Chloe',
        eventType: 'submitted',
        status: 'Pending Rescue',
        createdAt: new Date().toISOString(),
      },
    ]);

    await service.deleteAnimal(animalId);

    expect(service.animals().some((animal) => animal.id === animalId)).toBe(false);
    expect(service.adoptions().some((adoption) => adoption.animalId === animalId)).toBe(false);
    expect(service.reportHistory().some((entry) => entry.animalId === animalId)).toBe(false);
    expect(JSON.parse(localStorage.getItem('pawrescue.adoptions') ?? '[]')).toEqual(service.adoptions());
    expect(JSON.parse(localStorage.getItem('pawrescue.reportHistory') ?? '[]')).toEqual(service.reportHistory());
  });

  it('uses HttpClient to authenticate and preserves the login response behavior', async () => {
    const service = TestBed.inject(RescueDataService);
    const http = TestBed.inject(HttpTestingController);
    const login = service.login('client@example.com', 'correct horse');
    const request = http.expectOne((req) => req.params.get('action') === 'login');

    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ email: 'client@example.com', password: 'correct horse' });
    expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush({
      data: {
        token: 'session-token',
        user: { id: 'client-1', fullName: 'Client', email: 'client@example.com', role: 'user' },
      },
    });

    await login;

    expect(service.authenticated()).toBe(true);
    expect(localStorage.getItem('pawrescue.token')).toBe('session-token');
  });
});
