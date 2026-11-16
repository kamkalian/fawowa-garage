// Motorarten für Fahrräder und Anhänger (gleiche Werte wie in lib/rechenmodell.js: MOTOR_ARTEN)
const O = (wert, de, en) => ({ wert, de, en });

export const MOTOR_ARTEN = [
  O('mittelmotor', 'Mittelmotor', 'Mid-drive'),
  O('nabe_hinten', 'Nabenmotor hinten', 'Hub motor rear'),
  O('nabe_vorn', 'Nabenmotor vorn', 'Hub motor front')
];
