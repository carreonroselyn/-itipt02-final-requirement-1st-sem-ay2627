import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { expect, vi } from 'vitest';

import { HomePage } from './home.page';
import { beforeEach, describe, it } from 'node:test';

describe('HomePage', () => {
  let component: HomePage;
  let fixture: ComponentFixture<HomePage>;

  beforeEach(async () => {
    fixture = TestBed.createComponent(HomePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('keeps a signed-in client out of the admin dashboard', () => {
    component.data.authenticated.set(true);
    component.data.identityVerified.set(true);
    component.data.user.set({
      id: 'client-1',
      fullName: 'Client',
      email: 'client@example.com',
      role: 'user',
    });

    component.setPage('admin');

    expect(component.page()).toBe('feed');
  });

  it('keeps admin accounts on the admin dashboard instead of client pages', () => {
    component.data.authenticated.set(true);
    component.data.identityVerified.set(true);
    component.data.user.set({
      id: 'admin-1',
      fullName: 'Admin',
      email: 'admin@example.com',
      role: 'admin',
    });

    component.setPage('report');
    component.setPage('feed');

    expect(component.page()).toBe('admin');
  });

  it('requires sign-in before opening the report form', () => {
    component.setPage('report');

    expect(component.page()).toBe('login');
  });

  it('does not submit a report without a verified signed-in account', async () => {
    const createReport = vi.spyOn(component.data, 'createReport');
    component.reportForm.address = 'Main Street';
    component.reportForm.conditionNotes = 'Needs help';

    await component.submitReport();

    expect(createReport).not.toHaveBeenCalled();
    expect(component.page()).toBe('login');
  });

  it('opens the client feed after login even if account data cannot sync', async () => {
    vi.spyOn(component.data, 'login').mockImplementation(async () => {
      component.data.authenticated.set(true);
      component.data.identityVerified.set(true);
      component.data.user.set({
        id: 'client-1',
        fullName: 'Client',
        email: 'client@example.com',
        role: 'user',
      });
    });
    vi.spyOn(component.data, 'refresh').mockRejectedValue(new Error('Database schema is missing a required table.'));

    await component.submitAuth();

    expect(component.page()).toBe('feed');
    expect(component.toast()).toContain('account data could not sync');
  });

  it('opens the admin dashboard only when the server returns the admin role', async () => {
    component.loginForm.accountType = 'admin';
    vi.spyOn(component.data, 'login').mockImplementation(async () => {
      component.data.authenticated.set(true);
      component.data.identityVerified.set(true);
      component.data.user.set({
        id: 'admin-1',
        fullName: 'Rescue Admin',
        email: 'admin@example.com',
        role: 'admin',
      });
    });
    vi.spyOn(component.data, 'refresh').mockResolvedValue();

    await component.submitAuth();

    expect(component.page()).toBe('admin');
  });

  it('rejects credentials that do not match the selected account type', async () => {
    component.loginForm.accountType = 'admin';
    vi.spyOn(component.data, 'login').mockImplementation(async () => {
      component.data.authenticated.set(true);
      component.data.identityVerified.set(true);
      component.data.user.set({
        id: 'client-1',
        fullName: 'Client',
        email: 'client@example.com',
        role: 'user',
      });
    });

    await component.submitAuth();

    expect(component.data.authenticated()).toBe(false);
    expect(component.page()).toBe('login');
    expect(component.toast()).toContain('Choose the User account option');
  });

  it('shows only client navigation for user accounts', () => {
    component.data.authenticated.set(true);
    component.data.identityVerified.set(true);
    component.data.user.set({
      id: 'client-1',
      fullName: 'Client',
      email: 'client@example.com',
      role: 'user',
    });
    component.setPage('feed');
    fixture.detectChanges();

    const navigationText = fixture.nativeElement.querySelector('.side-nav').textContent as string;
    expect(navigationText).toContain('Adopt a pet');
    expect(navigationText).toContain('Report an animal');
    expect(navigationText).toContain('My reports');
    expect(navigationText).not.toContain('My dashboard');
  });

  it('shows only the admin dashboard navigation for admin accounts', () => {
    component.data.authenticated.set(true);
    component.data.identityVerified.set(true);
    component.data.user.set({
      id: 'admin-1',
      fullName: 'Admin',
      email: 'admin@example.com',
      role: 'admin',
    });
    component.setPage('admin');
    fixture.detectChanges();

    const navigationText = fixture.nativeElement.querySelector('.side-nav').textContent as string;
    expect(navigationText).toContain('Admin dashboard');
    expect(navigationText).not.toContain('Adopt a pet');
    expect(navigationText).not.toContain('Report an animal');
    expect(navigationText).not.toContain('My reports');
  });

  it('filters rescue dashboard metrics to their matching animal queues', () => {
    component.selectDashboardMetric('pending');
    expect(component.filteredAdminAnimals.length).toBeGreaterThan(0);
    expect(component.filteredAdminAnimals.every((animal) => animal.status === 'Pending Rescue')).toBe(true);

    component.selectDashboardMetric('treatment');
    expect(component.filteredAdminAnimals.length).toBeGreaterThan(0);
    expect(
      component.filteredAdminAnimals.every(
        (animal) => animal.status === 'In Treatment' || animal.status === 'Rescued / In Transit',
      ),
    ).toBe(true);

    component.selectDashboardMetric('ready');
    expect(component.filteredAdminAnimals.length).toBeGreaterThan(0);
    expect(component.filteredAdminAnimals.every((animal) => animal.status === 'Healed & Ready')).toBe(true);
  });

  it('opens adoption requests from the dashboard metric', () => {
    component.selectDashboardMetric('adoptions');

    expect(component.adminTab()).toBe('adoptions');
  });
});
