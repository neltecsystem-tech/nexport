import { requireNativeModule } from 'expo';
import { Platform } from 'react-native';

interface BadgerModuleType {
  setBadgeCount(count: number): boolean;
  removeBadge(): boolean;
}

const noop: BadgerModuleType = {
  setBadgeCount: () => false,
  removeBadge: () => false,
};

const Badger: BadgerModuleType =
  Platform.OS === 'android' ? requireNativeModule('Badger') : noop;

export function setBadgeCount(count: number): boolean {
  const safe = Math.max(0, Math.floor(count));
  return Badger.setBadgeCount(safe);
}

export function removeBadge(): boolean {
  return Badger.removeBadge();
}

export default Badger;
