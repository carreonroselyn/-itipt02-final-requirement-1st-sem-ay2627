export type AnimalStatus =
  'Pending Rescue' | 'Rescued / In Transit' | 'In Treatment' | 'Healed & Ready' | 'Reserved for Pickup';

export interface Animal {
  id: string;
  reportedBy: string;
  animalType: 'Dog' | 'Cat' | 'Other';
  photoUrl: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  conditionNotes: string;
  medicalNotes: string;
  status: AnimalStatus;
  name: string;
  age: number | null;
  gender: 'Male' | 'Female' | 'Unknown';
  createdAt: string;
}

export interface AnimalReportHistory {
  id: string;
  animalId: string;
  reportedBy: string;
  animalName: string;
  eventType: 'submitted' | 'status_changed';
  status: AnimalStatus;
  createdAt: string;
}

export interface Adoption {
  id: string;
  animalId: string;
  userId: string;
  applicantName: string;
  contactNumber: string;
  homeDetails: string;
  reason: string;
  requestStatus: 'Pending' | 'Approved' | 'Declined';
  submittedAt: string;
  animalName?: string;
  animalPhoto?: string;
}

export interface RescueUser {
  id: string;
  fullName: string;
  email: string;
  role: 'user' | 'admin';
}
