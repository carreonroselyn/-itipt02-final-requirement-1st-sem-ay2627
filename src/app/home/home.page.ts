import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal, type OnDestroy, type OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Geolocation } from '@capacitor/geolocation';
import { IonContent, IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  add,
  alertCircle,
  arrowForward,
  camera,
  checkmarkCircle,
  chevronDown,
  heart,
  home,
  images,
  locate,
  logOut,
  paw,
  people,
  search,
  shieldCheckmark,
  sparkles,
  time,
  trash,
} from 'ionicons/icons';

import type { Adoption, Animal, AnimalReportHistory, AnimalStatus } from '../models/animal.model';
import { RescueDataService } from '../services/rescue-data.service';

type AppPage = 'feed' | 'report' | 'my-reports' | 'admin' | 'login';
type FeedCategory = 'All' | 'Dogs' | 'Cats' | 'Others';
type AccountType = 'user' | 'admin';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  imports: [CommonModule, FormsModule, IonContent, IonIcon],
})
export class HomePage implements OnInit, OnDestroy {
  readonly data = inject(RescueDataService);
  readonly page = signal<AppPage>('login');
  readonly category = signal<FeedCategory>('All');
  readonly genderFilter = signal<'All' | 'Male' | 'Female'>('All');
  readonly ageFilter = signal<'All' | 'Young' | 'Adult'>('All');
  readonly searchText = signal('');
  readonly adminTab = signal<'rescue' | 'history' | 'adoptions'>('rescue');
  readonly selectedAnimal = signal<Animal | null>(null);
  readonly toast = signal('');
  readonly filteredAnimals = computed(() => {
    const needle = this.searchText().trim().toLowerCase();
    return this.data.animals().filter((animal) => {
      const available = animal.status === 'Healed & Ready';
      const matchesCategory =
        this.category() === 'All' ||
        (this.category() === 'Dogs' && animal.animalType === 'Dog') ||
        (this.category() === 'Cats' && animal.animalType === 'Cat') ||
        (this.category() === 'Others' && animal.animalType === 'Other');
      const matchesGender = this.genderFilter() === 'All' || animal.gender === this.genderFilter();
      const matchesAge =
        this.ageFilter() === 'All' ||
        (animal.age !== null && (this.ageFilter() === 'Young' ? animal.age <= 2 : animal.age > 2));
      const matchesSearch = `${animal.name} ${animal.address} ${animal.animalType}`.toLowerCase().includes(needle);
      return available && matchesCategory && matchesGender && matchesAge && matchesSearch;
    });
  });

  reportForm = {
    animalType: 'Dog' as Animal['animalType'],
    address: '',
    conditionNotes: '',
    photoUrl: '',
    latitude: null as number | null,
    longitude: null as number | null,
  };
  adoptionForm = { contactNumber: '', homeDetails: '', reason: '' };
  passwordForm = { currentPassword: '', newPassword: '', confirmPassword: '' };
  loginForm = {
    fullName: '',
    email: '',
    password: '',
    mode: 'login' as 'login' | 'register',
    accountType: 'user' as AccountType,
  };
  private toastTimer?: ReturnType<typeof setTimeout>;
  private refreshTimer?: ReturnType<typeof setInterval>;

  constructor() {
    addIcons({
      add,
      alertCircle,
      arrowForward,
      camera,
      checkmarkCircle,
      chevronDown,
      heart,
      home,
      images,
      locate,
      logOut,
      paw,
      people,
      search,
      shieldCheckmark,
      sparkles,
      time,
      trash,
    });
  }

  ngOnInit(): void {
    void this.data
      .refresh()
      .catch((error: unknown) => this.showToast(this.errorMessage(error)))
      .finally(() => {
        if (this.data.authenticated() && this.data.identityVerified()) {
          this.setPage(this.data.user().role === 'admin' ? 'admin' : 'feed');
        } else {
          this.setPage('login');
        }
      });
    this.refreshTimer = setInterval(
      () => void this.data.refresh().catch((error: unknown) => this.showToast(this.errorMessage(error))),
      30000,
    );
  }

  ngOnDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.toastTimer) clearTimeout(this.toastTimer);
  }

  get title(): string {
    return {
      feed: 'Find your new best friend',
      report: 'Report a stray animal',
      'my-reports': 'My reports and activity',
      admin: 'Rescue team dashboard',
      login: 'Welcome to PawRescue',
    }[this.page()];
  }

  get activeRescues(): number {
    return this.data
      .animals()
      .filter((animal) => animal.status !== 'Healed & Ready' && animal.status !== 'Reserved for Pickup').length;
  }

  get pendingRequests(): Adoption[] {
    return this.data.adoptions().filter((adoption) => adoption.requestStatus === 'Pending');
  }

  get myReports(): Animal[] {
    const user = this.data.user();
    return this.data
      .animals()
      .filter((animal) =>
        animal.reportedById
          ? animal.reportedById === user.id
          : user.id === 'demo-user' && animal.reportedBy === user.fullName,
      );
  }

  get myReportHistory(): AnimalReportHistory[] {
    const reportIds = new Set(this.myReports.map((animal) => animal.id));
    return this.data.reportHistory().filter((entry) => reportIds.has(entry.animalId));
  }

  get adminReportHistory(): AnimalReportHistory[] {
    return this.data.reportHistory();
  }

  reportHistoryLabel(entry: AnimalReportHistory): string {
    if (entry.eventType === 'submitted') return 'Report submitted';
    const labels: Record<AnimalStatus, string> = {
      'Pending Rescue': 'Report pending',
      'Rescued / In Transit': 'Rescue accepted',
      'In Treatment': 'Treatment started',
      'Healed & Ready': 'Cleared for adoption',
      'Reserved for Pickup': 'Reserved for pickup',
    };
    return labels[entry.status];
  }

  get myAdoptions(): Adoption[] {
    return this.data.adoptions().filter((adoption) => adoption.userId === this.data.user().id);
  }

  get pendingAnimalCount(): number {
    return this.data.animals().filter((animal) => animal.status === 'Pending Rescue').length;
  }

  get treatmentAnimalCount(): number {
    return this.data
      .animals()
      .filter((animal) => animal.status === 'In Treatment' || animal.status === 'Rescued / In Transit').length;
  }

  get readyAnimalCount(): number {
    return this.data.animals().filter((animal) => animal.status === 'Healed & Ready').length;
  }

  get adminAnimals(): Animal[] {
    return [...this.data.animals()].sort((first, second) => Date.parse(second.createdAt) - Date.parse(first.createdAt));
  }

  setPage(page: AppPage): void {
    const signedIn = this.data.authenticated() && this.data.identityVerified();
    const role = this.data.user().role;
    if ((page === 'report' || page === 'my-reports') && (!signedIn || role !== 'user')) {
      this.page.set(signedIn && role === 'admin' ? 'admin' : 'login');
      this.loginForm.mode = 'login';
      this.showToast(
        signedIn && role === 'admin'
          ? 'Client features are not available to admin accounts.'
          : 'Mag-sign in muna para magpatuloy.',
      );
      return;
    }
    if (page === 'admin' && (!signedIn || role !== 'admin')) {
      this.page.set(signedIn ? 'feed' : 'login');
      this.showToast('Admin login required.');
      return;
    }
    if (page === 'feed' && signedIn && role === 'admin') {
      this.page.set('admin');
      return;
    }
    this.selectedAnimal.set(null);
    this.page.set(page);
  }

  logout(): void {
    this.data.logout();
    this.setPage('login');
    this.showToast('Signed out. Mag-sign in ulit para magpatuloy.');
  }

  async submitReport(): Promise<void> {
    if (!this.data.authenticated() || !this.data.identityVerified() || this.data.user().role !== 'user') {
      this.setPage('login');
      this.showToast('User account ang kailangan para magpadala ng report.');
      return;
    }
    const { animalType, address, conditionNotes, photoUrl, latitude, longitude } = this.reportForm;
    if (!address.trim() || !conditionNotes.trim()) {
      this.showToast('Ilagay ang lokasyon at kondisyon ng hayop.');
      return;
    }
    try {
      await this.data.createReport({
        animalType,
        photoUrl,
        address: address.trim(),
        latitude,
        longitude,
        conditionNotes: conditionNotes.trim(),
        medicalNotes: '',
        reportedBy: this.data.user().fullName,
        name: animalType === 'Other' ? 'New rescue' : `New ${animalType.toLowerCase()} rescue`,
        age: null,
        gender: 'Unknown',
      });
      this.reportForm = {
        animalType: 'Dog',
        address: '',
        conditionNotes: '',
        photoUrl: '',
        latitude: null,
        longitude: null,
      };
      this.setPage('my-reports');
      this.showToast('Rescue alert submitted. Salamat sa pagtulong!');
    } catch (error) {
      this.showToast(this.errorMessage(error));
    }
  }

  async capturePhoto(): Promise<void> {
    try {
      const photo = await Camera.getPhoto({
        quality: 85,
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Prompt,
      });
      if (!photo.dataUrl) {
        this.showToast('Hindi nakuha ang larawan. Subukan ulit.');
        return;
      }
      if (photo.dataUrl.length > 3_400_000) {
        this.showToast('Maximum 2.5 MB ang photo para mabilis i-upload.');
        return;
      }
      this.reportForm.photoUrl = photo.dataUrl;
    } catch (error) {
      this.showToast(this.errorMessage(error));
    }
  }

  async chooseGalleryPhoto(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    input.value = '';
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      this.showToast('Pumili ng JPG, PNG, o WebP na larawan.');
      return;
    }
    if (file.size > 2_500_000) {
      this.showToast('Maximum 2.5 MB ang larawan. Pumili ng mas maliit na file.');
      return;
    }

    try {
      this.reportForm.photoUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result !== 'string') {
            reject(new Error('Hindi mabasa ang napiling larawan.'));
            return;
          }
          resolve(reader.result);
        };
        reader.onerror = () => reject(new Error('Hindi mabasa ang napiling larawan.'));
        reader.readAsDataURL(file);
      });
    } catch (error) {
      this.showToast(this.errorMessage(error));
    }
  }

  async locateMe(): Promise<void> {
    try {
      const { coords } = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 10000,
      });
      this.reportForm.latitude = coords.latitude;
      this.reportForm.longitude = coords.longitude;
      this.reportForm.address = `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`;
    } catch (error) {
      this.showToast(this.errorMessage(error));
    }
  }

  async advanceAnimal(animal: Animal): Promise<void> {
    const workflow: Partial<Record<AnimalStatus, AnimalStatus>> = {
      'Pending Rescue': 'Rescued / In Transit',
      'Rescued / In Transit': 'In Treatment',
      'In Treatment': 'Healed & Ready',
    };
    const nextStatus = workflow[animal.status];
    if (!nextStatus) return;
    let medicalNotes = animal.medicalNotes;
    if (nextStatus === 'In Treatment' || nextStatus === 'Healed & Ready') {
      const notes = window.prompt(
        nextStatus === 'In Treatment' ? 'Treatment / vet notes:' : 'Medical clearance notes:',
        animal.medicalNotes,
      );
      if (notes === null) return;
      medicalNotes = notes.trim();
    }
    try {
      await this.data.updateAnimal(animal.id, { status: nextStatus, medicalNotes });
      this.showToast(`${animal.name} updated: ${nextStatus}`);
    } catch (error) {
      this.showToast(this.errorMessage(error));
    }
  }

  async editAnimalProfile(animal: Animal): Promise<void> {
    const name = window.prompt('Pet name:', animal.name);
    if (name === null) return;
    const ageInput = window.prompt('Age in years (leave blank if unknown):', animal.age?.toString() ?? '');
    if (ageInput === null) return;
    const age = ageInput.trim() === '' ? null : Number(ageInput);
    if (age !== null && (!Number.isInteger(age) || age < 0 || age > 100)) {
      this.showToast('Age must be a whole number between 0 and 100.');
      return;
    }
    const genderInput = window.prompt('Gender: Male, Female, or Unknown', animal.gender);
    if (genderInput === null) return;
    if (!['Male', 'Female', 'Unknown'].includes(genderInput)) {
      this.showToast('Gender must be Male, Female, or Unknown.');
      return;
    }
    if (!name.trim()) {
      this.showToast('Pet name cannot be empty.');
      return;
    }
    try {
      await this.data.updateAnimal(animal.id, {
        name: name.trim(),
        age,
        gender: genderInput as Animal['gender'],
      });
      this.showToast('Pet profile updated.');
    } catch (error) {
      this.showToast(this.errorMessage(error));
    }
  }

  async deleteAnimal(animal: Animal): Promise<void> {
    if (!window.confirm(`Delete the report for ${animal.name}? This cannot be undone.`)) return;
    try {
      await this.data.deleteAnimal(animal.id);
      this.showToast(`${animal.name}'s report deleted.`);
    } catch (error) {
      this.showToast(this.errorMessage(error));
    }
  }

  startAdoption(animal: Animal): void {
    if (
      !this.data.authenticated() ||
      !this.data.identityVerified() ||
      !this.data.user().id ||
      this.data.user().role !== 'user'
    ) {
      if (this.data.user().role === 'admin') {
        this.setPage('admin');
        this.showToast('Adoption is only available to user accounts.');
      } else {
        this.setPage('login');
        this.showToast('Mag-sign in bilang adopter para mag-request.');
      }
      return;
    }
    this.adoptionForm = { contactNumber: '', homeDetails: '', reason: '' };
    this.selectedAnimal.set(animal);
  }

  async submitAdoption(): Promise<void> {
    if (!this.data.authenticated() || !this.data.identityVerified() || this.data.user().role !== 'user') {
      this.selectedAnimal.set(null);
      this.setPage(this.data.user().role === 'admin' ? 'admin' : 'login');
      this.showToast('Adoption is only available to signed-in user accounts.');
      return;
    }
    const animal = this.selectedAnimal();
    const form = this.adoptionForm;
    if (!animal) return;
    if (!form.contactNumber.trim() || !form.homeDetails.trim() || !form.reason.trim()) {
      this.showToast('Kumpletuhin ang lahat ng screening details.');
      return;
    }
    try {
      await this.data.createAdoption({
        animalId: animal.id,
        userId: this.data.user().id,
        applicantName: this.data.user().fullName,
        contactNumber: form.contactNumber.trim(),
        homeDetails: form.homeDetails.trim(),
        reason: form.reason.trim(),
        animalName: animal.name,
        animalPhoto: animal.photoUrl,
      });
      this.selectedAnimal.set(null);
      this.setPage('my-reports');
      this.showToast('Adoption request sent. A rescuer will review it soon.');
    } catch (error) {
      this.showToast(this.errorMessage(error));
    }
  }

  async reviewAdoption(adoption: Adoption, status: 'Approved' | 'Declined'): Promise<void> {
    try {
      await this.data.updateAdoption(adoption.id, status);
      this.showToast(`Request ${status.toLowerCase()}.`);
    } catch (error) {
      this.showToast(this.errorMessage(error));
    }
  }

  async submitAuth(): Promise<void> {
    try {
      if (this.loginForm.mode === 'register') {
        if (this.loginForm.accountType !== 'user') {
          this.showToast('Admin account registration is not available here.');
          return;
        }
        await this.data.register(this.loginForm.fullName.trim(), this.loginForm.email.trim(), this.loginForm.password);
      } else {
        await this.data.login(this.loginForm.email.trim(), this.loginForm.password);
        if (this.data.user().role !== this.loginForm.accountType) {
          const actualRole = this.data.user().role;
          this.data.logout();
          this.showToast(
            `This is a ${actualRole} account. Choose the ${actualRole === 'admin' ? 'Admin' : 'User'} account option.`,
          );
          return;
        }
      }
      this.setPage(this.data.user().role === 'admin' ? 'admin' : 'feed');
      try {
        await this.data.refresh();
        if (this.data.backendOnline()) {
          this.showToast(`Welcome, ${this.data.user().fullName}!`);
        } else {
          this.showToast(`Signed in, but account data could not sync: ${this.data.backendMessage()}`);
        }
      } catch (error) {
        this.showToast(`Signed in, but account data could not sync: ${this.errorMessage(error)}`);
      }
    } catch (error) {
      this.showToast(this.errorMessage(error));
    }
  }

  selectAccountType(accountType: AccountType): void {
    this.loginForm.accountType = accountType;
    if (accountType === 'admin') this.loginForm.mode = 'login';
  }

  async changePassword(): Promise<void> {
    const { currentPassword, newPassword, confirmPassword } = this.passwordForm;
    if (newPassword.length < 8) {
      this.showToast('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      this.showToast('Hindi magkapareho ang bagong password at confirmation.');
      return;
    }
    try {
      await this.data.changePassword(currentPassword, newPassword);
      this.passwordForm = { currentPassword: '', newPassword: '', confirmPassword: '' };
      this.showToast('Password updated. Other sign-in sessions were signed out.');
    } catch (error) {
      this.showToast(this.errorMessage(error));
    }
  }

  photo(animal: Animal): string {
    return (
      animal.photoUrl || 'https://images.unsplash.com/photo-1450778869180-41d0601e046e?auto=format&fit=crop&w=1000&q=85'
    );
  }

  timeLabel(isoDate: string): string {
    const hours = Math.max(0, Math.floor((Date.now() - Date.parse(isoDate)) / 3_600_000));
    if (hours < 1) return 'Just now';
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  private showToast(message: string): void {
    this.toast.set(message);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(''), 3500);
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'May hindi inaasahang error. Subukan ulit.';
  }
}
