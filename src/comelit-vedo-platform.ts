import { VedoClientConfig } from 'comelit-client';
import { VedoAlarm, VedoAlarmConfig } from './accessories/vedo-alarm';
import { Homebridge, Logger } from '../types';
import { VedoSensor } from './accessories/vedo-sensor';
import Timeout = NodeJS.Timeout;

export interface PlatformConfig {
  alarm_address: string;
  alarm_port?: number;
  alarm_code: string;
  map_sensors: boolean;
  update_interval?: number;
  area_mapping: {
    away_areas?: string[];
    night_areas?: string[];
    home_areas?: string[];
  };
  advanced?: VedoClientConfig;
}

const DEFAULT_ALARM_CHECK_TIMEOUT = 5000;

export class ComelitVedoPlatform {
  private readonly log: Logger;

  private readonly homebridge: Homebridge;

  private readonly config: PlatformConfig;

  private timeout: Timeout;

  private mappedZones: VedoSensor[];

  private alarm: VedoAlarm;

  constructor(log: Logger, config: PlatformConfig, homebridge: Homebridge) {
    this.log = log;
    this.log('Initializing platform: ', { ...config, alarm_code: '******' });
    this.config = config;
    // Save the API object as plugin needs to register new accessory via this object
    this.homebridge = homebridge;
    this.log(`homebridge API version: ${homebridge.version}`);
    this.homebridge.on('didFinishLaunching', () => this.startPolling());
  }

  private startPolling() {
    const checkFrequency = this.config.update_interval
      ? this.config.update_interval * 1000
      : DEFAULT_ALARM_CHECK_TIMEOUT;
    this.log(`Setting up polling timeout every ${checkFrequency / 1000} secs`);
    this.timeout = setTimeout(async () => {
      try {
        const alarmAreas = await this.alarm.checkAlarm();
        if (alarmAreas) {
          this.log.debug(
            `Found ${alarmAreas.length} areas: ${alarmAreas.map(a => a.description).join(', ')}`
          );
          this.alarm.update(alarmAreas);
          if (this.config.map_sensors) {
            const zones = await this.alarm.fetchZones();
            if (zones) {
              this.log.debug(
                `Found ${zones.length} areas: ${zones
                  .filter(zone => zone.description !== '')
                  .map(a => a.description)
                  .join(', ')}`
              );
              zones
                .filter(zone => zone.description !== '')
                .forEach(zone =>
                  this.mappedZones.find(z => z.name === zone.description).update(zone)
                );
            } else {
              this.log.warn(`No zone found`);
            }
          }
        }
      } catch (e) {
        this.log.error(e.message, e);
      }
      this.timeout.refresh();
    }, checkFrequency);
  }

  async accessories(callback: (array: any[]) => void) {
    if (this.hasValidConfig()) {
      this.log(`Map VEDO alarm @ ${this.config.alarm_address}:${this.config.alarm_port || 80}`);
      const advanced: Partial<VedoClientConfig> = this.config.advanced || {};
      const area_mapping = this.config.area_mapping || {};
      const config: VedoAlarmConfig = {
        ...advanced,
        away_areas: area_mapping.away_areas ? [...area_mapping.away_areas] : [],
        home_areas: area_mapping.home_areas ? [...area_mapping.home_areas] : [],
        night_areas: area_mapping.night_areas ? [...area_mapping.night_areas] : [],
      };
      this.alarm = new VedoAlarm(
        this.log,
        this.config.alarm_address,
        this.config.alarm_port,
        this.config.alarm_code,
        config
      );
      if (this.config.map_sensors) {
        const zones = await this.alarm.fetchZones();
        if (zones && zones.length) {
          this.mappedZones = zones
            .filter(zone => zone.description !== '')
            .map(zone => new VedoSensor(this.log, zone.description, zone));
          callback([this.alarm, ...this.mappedZones]);
        }
      } else {
        callback([this.alarm]);
      }
    } else {
      this.log.error('Invalid configuration ', this.config);
      callback([]);
    }
  }

  private hasValidConfig() {
    return this.config && this.config.alarm_address && this.config.alarm_code;
  }
}
