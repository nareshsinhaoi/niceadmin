export function serializeBigInt(obj) {
    return JSON.parse(
        JSON.stringify(obj, (_, value) =>
            typeof value === 'bigint' ? value.toString() : value
        )
    );
}

export const bufferToString = (val) => {
    if (Buffer.isBuffer(val)) {
        return val.toString('utf8');
    }
    return val;
};

export const parseToNumber = (value) => {
    if (value === undefined || value === null) return undefined;
    return value === '1' || value === 1 || value === true ? 1 : 0;
};

export const getOrientationScientific = (width, height, tolerance = 0.05) => {
    const ratio = width / height;
    if (ratio > 1 + tolerance) return "horizontal";
    if (ratio < 1 - tolerance) return "vertical";
    return "square";
};

export function convertBigIntToString(obj) {
  if (obj === null || obj === undefined) {
    return obj;
  }
  
  if (typeof obj === 'bigint') {
    return obj.toString();
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => convertBigIntToString(item));
  }
  
  if (typeof obj === 'object') {
    const newObj = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        newObj[key] = convertBigIntToString(obj[key]);
      }
    }
    return newObj;
  }
  
  return obj;
}