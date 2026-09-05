import { VinInfo } from '../types';

export class VinDecoder {
  private static WMI_TABLE: Record<string, { manufacturer: string; country: string }> = {
    '1HG': { manufacturer: 'Honda', country: 'USA' },
    '1FA': { manufacturer: 'Ford Motor Company', country: 'USA' },
    '1GC': { manufacturer: 'General Motors (Chevrolet)', country: 'USA' },
    '2T1': { manufacturer: 'Toyota Motor Manufacturing Canada', country: 'Canada' },
    '3VW': { manufacturer: 'Volkswagen de Mexico', country: 'Mexico' },
    '4T1': { manufacturer: 'Toyota Motor Manufacturing Kentucky', country: 'USA' },
    '4T3': { manufacturer: 'Toyota Motor Manufacturing Kentucky', country: 'USA' },
    '5TB': { manufacturer: 'Toyota Motor Manufacturing Indiana', country: 'USA' },
    'JTD': { manufacturer: 'Toyota Motor Corporation', country: 'Japan' },
    'JTE': { manufacturer: 'Toyota Motor Corporation', country: 'Japan' },
    'JTH': { manufacturer: 'Lexus (Toyota Motor Corp)', country: 'Japan' },
    'JTJ': { manufacturer: 'Lexus (Toyota Motor Corp)', country: 'Japan' },
    'JN1': { manufacturer: 'Nissan Motor Co.', country: 'Japan' },
    'KMH': { manufacturer: 'Hyundai Motor Company', country: 'South Korea' },
    'KNA': { manufacturer: 'Kia Motors Corporation', country: 'South Korea' },
    'WBA': { manufacturer: 'BMW AG', country: 'Germany' },
    'WDB': { manufacturer: 'Mercedes-Benz AG', country: 'Germany' },
    'WDC': { manufacturer: 'DaimlerChrysler AG / Mercedes', country: 'Germany' },
    'WAU': { manufacturer: 'Audi AG', country: 'Germany' },
  };

  private static YEAR_CODES: Record<string, number> = {
    'A': 2010, 'B': 2011, 'C': 2012, 'D': 2013, 'E': 2014, 'F': 2015,
    'G': 2016, 'H': 2017, 'J': 2018, 'K': 2019, 'L': 2020, 'M': 2021,
    'N': 2022, 'P': 2023, 'R': 2024, 'S': 2025, 'T': 2026
  };

  public static decode(vin: string): VinInfo {
    return this.decodeVin(vin);
  }

  public static decodeVin(vin: string): VinInfo {
    const cleanVin = vin.trim().toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '');

    if (cleanVin.length !== 17) {
      return {
        rawVin: cleanVin || vin,
        wmi: cleanVin.substring(0, 3),
        vds: cleanVin.substring(3, 9),
        vis: cleanVin.substring(9, 17),
        manufacturer: 'Unknown / غير محدد',
        model: 'Unknown Model',
        year: 0,
        plant: 'Unknown',
        sequentialNumber: 'Unknown',
        country: 'Unknown',
        isValid: false
      };
    }

    const wmi = cleanVin.substring(0, 3);
    const vds = cleanVin.substring(3, 9);
    const vis = cleanVin.substring(9, 17);
    const yearChar = cleanVin.charAt(9);
    const plant = cleanVin.charAt(10);
    const sequential = cleanVin.substring(11, 17);

    const wmiInfo = this.WMI_TABLE[wmi] || {
      manufacturer: wmi.startsWith('J') ? 'Toyota / Japanese OEM' : wmi.startsWith('1') || wmi.startsWith('4') || wmi.startsWith('5') ? 'Toyota / North America OEM' : wmi.startsWith('K') ? 'Korean OEM' : wmi.startsWith('W') ? 'German OEM' : 'Standard OEM Manufacturer',
      country: wmi.startsWith('J') ? 'Japan' : wmi.startsWith('K') ? 'South Korea' : wmi.startsWith('W') ? 'Germany' : 'United States'
    };

    const year = this.YEAR_CODES[yearChar] || undefined;

    // Detect model approximation if Toyota/Lexus/etc.
    let model = 'Unknown Model';
    if (wmi.startsWith('JT') || wmi === '4T1' || wmi === '4T3') {
      if (vds.startsWith('BK') || vds.startsWith('BF')) model = 'Camry';
      else if (vds.startsWith('BU') || vds.startsWith('BE')) model = 'Corolla';
      else if (vds.startsWith('ZA') || vds.startsWith('HY')) model = 'ES350';
      else if (vds.startsWith('GS') || vds.startsWith('UR')) model = 'Land Cruiser';
    }

    return {
      rawVin: cleanVin,
      wmi,
      vds,
      vis,
      manufacturer: wmiInfo.manufacturer.includes('Toyota') ? 'Toyota' : wmiInfo.manufacturer.includes('Lexus') ? 'Lexus' : wmiInfo.manufacturer,
      model,
      year,
      plant: `Plant ${plant}`,
      sequentialNumber: sequential,
      country: wmiInfo.country,
      isValid: true
    };
  }
}
