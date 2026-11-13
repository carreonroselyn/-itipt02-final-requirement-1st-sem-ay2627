import { Injectable, signal } from '@angular/core';

import { environment } from '../../environments/environment';
import type { Adoption, Animal, AnimalReportHistory, RescueUser } from '../models/animal.model';

const demoAnimals: Animal[] = [
  {
    id: 'paw-101',
    reportedBy: 'Mika Santos',
    animalType: 'Dog',
    photoUrl: 'https://images.unsplash.com/photo-1552053831-71594a27632d?auto=format&fit=crop&w=1000&q=85',
    address: 'Rizal Street, San Leonardo, Nueva Ecija',
    latitude: 15.363,
    longitude: 120.963,
    conditionNotes: 'Found near the public market. Friendly and in good spirits.',
    medicalNotes: 'Vaccinated and cleared by the partner veterinarian.',
    status: 'Healed & Ready',
    name: 'Milo',
    age: 1,
    gender: 'Male',
    createdAt: '2026-11-10T09:30:00+08:00',
  },
  {
    id: 'paw-102',
    reportedBy: 'Carlo Reyes',
    animalType: 'Cat',
    photoUrl: 'https://images.unsplash.com/photo-1573865526739-10659fec78a5?auto=format&fit=crop&w=1000&q=85',
    address: 'Oak Avenue, San Leonardo, Nueva Ecija',
    latitude: 15.368,
    longitude: 120.957,
    conditionNotes: 'Rescued from a quiet residential street.',
    medicalNotes: 'Recovered well after a check-up. Ready for a loving home.',
    status: 'Healed & Ready',
    name: 'Chloe',
    age: 2,
    gender: 'Female',
    createdAt: '2026-11-09T15:00:00+08:00',
  },
  {
    id: 'paw-103',
    reportedBy: 'Ana Cruz',
    animalType: 'Dog',
    photoUrl: 'https://images.unsplash.com/photo-1543466835-00a7907e9de1?auto=format&fit=crop&w=1000&q=85',
    address: 'Barangay Tambo, San Leonardo',
    latitude: 15.356,
    longitude: 120.972,
    conditionNotes: 'A young dog was seen limping near the highway.',
    medicalNotes: 'Under observation after initial treatment.',
    status: 'In Treatment',
    name: 'Rocky',
    age: 3,
    gender: 'Male',
    createdAt: '2026-11-11T12:15:00+08:00',
  },
  {
    id: 'paw-104',
    reportedBy: 'Jules Dela Cruz',
    animalType: 'Cat',
    photoUrl: 'https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?auto=format&fit=crop&w=1000&q=85',
    address: 'Oak Park, San Leonardo',
    latitude: 15.371,
    longitude: 120.951,
    conditionNotes: 'Small kitten found in a box beside the park.',
    medicalNotes: '',
    status: 'Pending Rescue',
    name: 'Luna',
    age: null,
    gender: 'Female',
    createdAt: '2026-11-12T08:25:00+08:00',
  },
];

const demoAdoptions: Adoption[] = [
  {
    id: 'adopt-201',
    animalId: 'paw-102',
    userId: 'demo-user',
    applicantName: 'Mika Santos',
    contactNumber: '0917 555 0142',
    homeDetails: 'A small house with a fenced garden.',
    reason: 'I would love to give a rescued cat a safe home.',
    requestStatus: 'Pending',
    submittedAt: '2026-11-12T10:00:00+08:00',
    animalName: 'Chloe',
  },
];

@Injectable({ providedIn: 'root' })
export class RescueDataService {
  private token = localStorage.getItem('pawrescue.token');
  readonly authenticated = signal(Boolean(this.token));
  readonly identityVerified = signal(false);
  readonly animals = signal<Animal[]>(this.token ? [] : this.readStored('pawrescue.animals', demoAnimals));
  readonly reportHistory = signal<AnimalReportHistory[]>(
    this.token ? [] : this.readStored('pawrescue.reportHistory', []),
  );
  readonly adoptions = signal<Adoption[]>(this.token ? [] : this.readStored('pawrescue.adoptions', demoAdoptions));
  readonly user = signal<RescueUser>({
    id: 'demo-user',
    fullName: 'Mika Santos',
    email: 'mika@example.com',
    role: 'user',
  });
  readonly backendOnline = signal(false);
  readonly backendMessage = signal('Demo mode • start FastAPI and XAMPP MySQL to sync your data');
  private demoDataSanitized = false;

  async refresh(): Promise<void> {
    if (!this.token) {
      if (!this.demoDataSanitized) this.useDemoUser();
      this.backendOnline.set(false);
      this.backendMessage.set('Demo user • sign in to sync your data');
      return;
    }
    try {
      this.user.set(await this.request<RescueUser>('me'));
      this.identityVerified.set(true);
      const animals = await this.request<Animal[]>('animals');
      const [adoptions, reportHistory] = await Promise.all([
        this.request<Adoption[]>('adoptions'),
        this.request<AnimalReportHistory[]>('report-history'),
      ]);
      this.animals.set(animals);
      this.adoptions.set(adoptions);
      this.reportHistory.set(reportHistory);
      this.backendOnline.set(true);
      this.backendMessage.set('Connected to PawRescue database');
      this.persist();
    } catch (error) {
      this.backendOnline.set(false);
      if (error instanceof TypeError) {
        this.backendMessage.set('Demo mode • start FastAPI and XAMPP MySQL to sync');
        return;
      }
      this.backendMessage.set('Database connection needs attention');
      throw error;
    }
  }

  async login(email: string, password: string): Promise<void> {
    const result = await this.request<{ token: string; user: RescueUser }>('login', {
      email,
      password,
    });
    this.token = result.token;
    localStorage.setItem('pawrescue.token', result.token);
    this.authenticated.set(true);
    this.identityVerified.set(true);
    this.clearAccountData();
    this.user.set(result.user);
    this.persist();
  }

  async register(fullName: string, email: string, password: string): Promise<void> {
    const result = await this.request<{ token: string; user: RescueUser }>('register', {
      fullName,
      email,
      password,
    });
    this.token = result.token;
    localStorage.setItem('pawrescue.token', result.token);
    this.authenticated.set(true);
    this.identityVerified.set(true);
    this.clearAccountData();
    this.user.set(result.user);
    this.backendOnline.set(true);
    this.backendMessage.set('Connected to PawRescue database');
    this.persist();
  }

  useDemoUser(): void {
    this.demoDataSanitized = true;
    this.token = null;
    this.authenticated.set(false);
    this.identityVerified.set(false);
    localStorage.removeItem('pawrescue.token');
    this.animals.set(demoAnimals);
    this.reportHistory.set([]);
    this.adoptions.set(demoAdoptions);
    this.user.set({
      id: 'demo-user',
      fullName: 'Mika Santos',
      email: 'mika@example.com',
      role: 'user',
    });
    this.backendOnline.set(false);
    this.backendMessage.set('Demo user • start FastAPI and XAMPP MySQL to use the database');
    this.persist();
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const result = await this.request<{ token: string }>('password', { currentPassword, newPassword }, 'PATCH');
    this.token = result.token;
    localStorage.setItem('pawrescue.token', result.token);
    await this.refresh();
  }

  async createReport(report: Omit<Animal, 'id' | 'createdAt' | 'status'>): Promise<void> {
    if (!this.token) {
      throw new Error('Mag-sign in bago magpadala ng report.');
    }
    await this.request('animals', report, 'POST');
    await this.refresh();
  }

  async updateAnimal(id: string, updates: Partial<Animal>): Promise<void> {
    if (this.token) {
      await this.request(`animals/${encodeURIComponent(id)}`, updates, 'PATCH');
      await this.refresh();
      return;
    }
    const previous = this.animals().find((animal) => animal.id === id);
    this.animals.update((items) => items.map((animal) => (animal.id === id ? { ...animal, ...updates } : animal)));
    if (updates.status && previous?.status !== updates.status) {
      const animal = this.animals().find((item) => item.id === id);
      if (animal) {
        this.reportHistory.update((items) => [
          {
            id: `history-${Date.now()}`,
            animalId: animal.id,
            reportedBy: animal.reportedBy,
            animalName: animal.name,
            eventType: 'status_changed',
            status: animal.status,
            createdAt: new Date().toISOString(),
          },
          ...items,
        ]);
      }
    }
    this.persist();
  }

  async deleteAnimal(id: string): Promise<void> {
    if (this.token) {
      await this.request(`animals/${encodeURIComponent(id)}`, undefined, 'DELETE');
      await this.refresh();
      return;
    }
    if (this.adoptions().some((adoption) => adoption.animalId === id)) {
      throw new Error('Animal reports with adoption history cannot be deleted.');
    }
    this.animals.update((items) => items.filter((animal) => animal.id !== id));
    this.persist();
  }

  async createAdoption(adoption: Omit<Adoption, 'id' | 'submittedAt' | 'requestStatus'>): Promise<void> {
    if (this.token) {
      await this.request('adoptions', adoption, 'POST');
      await this.refresh();
      return;
    }
    this.adoptions.update((items) => [
      {
        ...adoption,
        id: `adopt-${Date.now()}`,
        submittedAt: new Date().toISOString(),
        requestStatus: 'Pending',
      },
      ...items,
    ]);
    this.persist();
  }

  async updateAdoption(id: string, requestStatus: 'Approved' | 'Declined'): Promise<void> {
    if (this.token) {
      await this.request(`adoptions/${encodeURIComponent(id)}`, { requestStatus }, 'PATCH');
      await this.refresh();
      return;
    }
    const adoption = this.adoptions().find((item) => item.id === id);
    if (!adoption) return;
    this.adoptions.update((items) => items.map((item) => (item.id === id ? { ...item, requestStatus } : item)));
    if (requestStatus === 'Approved') {
      await this.updateAnimal(adoption.animalId, { status: 'Reserved for Pickup' });
    }
    this.persist();
  }

  logout(): void {
    this.useDemoUser();
  }

  private async request<T>(
    action: string,
    body?: unknown,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = body ? 'POST' : 'GET',
  ): Promise<T> {
    const response = await fetch(`${environment.apiUrl}?action=${action}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = (await response.json()) as { data?: T; error?: string; detail?: string };
    if (!response.ok) {
      throw new Error(result.error ?? result.detail ?? 'Hindi nakumpleto ang request.');
    }
    return result.data as T;
  }

  private persist(): void {
    localStorage.setItem('pawrescue.animals', JSON.stringify(this.animals()));
    localStorage.setItem('pawrescue.reportHistory', JSON.stringify(this.reportHistory()));
    localStorage.setItem('pawrescue.adoptions', JSON.stringify(this.adoptions()));
    localStorage.setItem('pawrescue.user', JSON.stringify(this.user()));
  }

  private clearAccountData(): void {
    this.animals.set([]);
    this.reportHistory.set([]);
    this.adoptions.set([]);
  }

  private readStored<T>(key: string, fallback: T): T {
    try {
      const value = localStorage.getItem(key);
      return value ? (JSON.parse(value) as T) : fallback;
    } catch {
      return fallback;
    }
  }
}
