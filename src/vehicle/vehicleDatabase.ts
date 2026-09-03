export interface VehicleModelDefinition {
  id: string;
  manufacturer: string;
  manufacturerAr: string;
  model: string;
  modelAr: string;
  years: number[];
  engines: string[];
  protocols: string[];
  supportedEcus: string[];
  serviceProcedures: string[];
}

export const VEHICLE_DATABASE: VehicleModelDefinition[] = [
  {
    id: 'toyota-camry',
    manufacturer: 'Toyota',
    manufacturerAr: 'تويوتا',
    model: 'Camry (XV50/XV70)',
    modelAr: 'كامري',
    years: [2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025],
    engines: ['2.5L 2AR-FE / A25A-FKS', '3.5L 2GR-FE / 2GR-FKS', '2.5L Hybrid A25A-FXS'],
    protocols: ['ISO 15765-4 CAN 11/500k', 'Toyota Enhanced KWP/UDS'],
    supportedEcus: ['Engine (0x7E0)', 'Transmission (0x7E1)', 'ABS/VSC (0x7E2)', 'Airbag (0x7E3)', 'Main Body (0x7E4)', 'EPS (0x720)', 'TPMS (0x7E7)'],
    serviceProcedures: ['Zero Point Calibration', 'Idle Air Volume Relearn', 'Brake Bleeding', 'ATF Temp Check', 'TPMS ID Registration']
  },
  {
    id: 'toyota-corolla',
    manufacturer: 'Toyota',
    manufacturerAr: 'تويوتا',
    model: 'Corolla (E170/E210)',
    modelAr: 'كورولا',
    years: [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025],
    engines: ['1.6L 1ZR-FE', '2.0L M20A-FKS', '1.8L Hybrid 2ZR-FXE'],
    protocols: ['ISO 15765-4 CAN 11/500k'],
    supportedEcus: ['Engine (0x7E0)', 'CVT / Transmission (0x7E1)', 'ABS/VSC (0x7E2)', 'Airbag (0x7E3)', 'BCM (0x7E4)', 'EPS (0x720)'],
    serviceProcedures: ['Zero Point Calibration', 'Throttle Adaptation', 'CVT Fluid Degradation Reset', 'Brake Bleeding']
  },
  {
    id: 'toyota-landcruiser',
    manufacturer: 'Toyota',
    manufacturerAr: 'تويوتا',
    model: 'Land Cruiser (J200/J300)',
    modelAr: 'لاند كروزر',
    years: [2008, 2012, 2016, 2019, 2021, 2022, 2023, 2024, 2025],
    engines: ['4.0L 1GR-FE V6', '4.6L 1UR-FE V8', '5.7L 3UR-FE V8', '3.5L Twin-Turbo V35A-FTS V6', '3.3L Diesel F33A-FTV'],
    protocols: ['ISO 15765-4 CAN 11/500k', 'Toyota Multi-Bus Gateway'],
    supportedEcus: ['Engine (0x7E0)', 'Transmission (0x7E1)', 'ABS/VSC/KDSS (0x7E2)', 'Airbag (0x7E3)', 'Body Gateway (0x7E4)', 'Transfer Case (0x7E5)'],
    serviceProcedures: ['Zero Point Calibration (Deceleration & Yaw)', 'Air Suspension Leveling', 'ATF Temp Inspection', 'KDSS Bleed Mode']
  },
  {
    id: 'lexus-es350',
    manufacturer: 'Lexus',
    manufacturerAr: 'لكزس',
    model: 'Lexus ES 350 / 300h',
    modelAr: 'إي إس 350 / 300 هايبرد',
    years: [2013, 2016, 2019, 2021, 2023, 2024, 2025],
    engines: ['3.5L 2GR-FKS V6', '2.5L Hybrid A25A-FXS'],
    protocols: ['ISO 15765-4 CAN 11/500k'],
    supportedEcus: ['Engine (0x7E0)', 'Transmission (0x7E1)', 'ABS/VSC (0x7E2)', 'SRS (0x7E3)', 'Body (0x7E4)', 'EPS (0x720)'],
    serviceProcedures: ['Zero Point Calibration', 'EPB Service Mode', 'Battery Initialization', 'TPMS ID Registration']
  },
  {
    id: 'nissan-patrol',
    manufacturer: 'Nissan',
    manufacturerAr: 'نيسان',
    model: 'Patrol (Y62)',
    modelAr: 'باترول',
    years: [2010, 2014, 2018, 2020, 2022, 2024, 2025],
    engines: ['4.0L VQ40DE V6', '5.6L VK56VD V8'],
    protocols: ['ISO 15765-4 CAN 11/500k', 'Nissan Consult-III Protocol'],
    supportedEcus: ['Engine (0x7E0)', 'A/T (0x7E1)', 'ABS/ESP (0x7E2)', 'Airbag (0x7E3)', 'BCM (0x7E4)'],
    serviceProcedures: ['Throttle Body Relearn (Idle Air)', 'Steering Angle Sensor Reset', 'HBMC Hydraulic Calibration']
  },
  {
    id: 'hyundai-tucson',
    manufacturer: 'Hyundai',
    manufacturerAr: 'هيونداي',
    model: 'Tucson / Elantra / Sonata',
    modelAr: 'توسان / إلنترا / سوناتا',
    years: [2016, 2018, 2020, 2022, 2024, 2025],
    engines: ['1.6L T-GDI', '2.0L Nu MPI', '2.5L Smartstream'],
    protocols: ['ISO 15765-4 CAN 11/500k', 'Hyundai/Kia Extended UDS'],
    supportedEcus: ['Engine (0x7E0)', 'Dual Clutch / A/T (0x7E1)', 'ESC/ABS (0x7E2)', 'Airbag (0x7E3)', 'BCM (0x7E4)', 'MDPS Steering (0x720)'],
    serviceProcedures: ['DCT Clutch Learn', 'SAS Calibration', 'EPB Service Mode', 'Oil Service Interval Reset']
  },
  {
    id: 'ford-f150',
    manufacturer: 'Ford',
    manufacturerAr: 'فورد',
    model: 'F-150 / Explorer / Taurus',
    modelAr: 'إف-150 / إكسبلورر / تورس',
    years: [2015, 2018, 2020, 2022, 2024, 2025],
    engines: ['2.7L / 3.5L EcoBoost', '5.0L Coyote V8'],
    protocols: ['ISO 15765-4 CAN 11/500k', 'Ford MS-CAN / HS-CAN Gateway'],
    supportedEcus: ['PCM (0x7E0)', 'TCM (0x7E1)', 'ABS (0x7E2)', 'RCM Airbag (0x7E3)', 'BCM (0x726)', 'PSC (0x730)'],
    serviceProcedures: ['BMS Battery Reset', 'EPB Service Mode', 'Misfire Profile Correction', 'TPMS Relearn']
  }
];
