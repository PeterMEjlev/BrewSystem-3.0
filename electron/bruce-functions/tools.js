'use strict';

// ── Register tool/utility functions on Bruce ────────────────────────────────

function register(bruce, apiCall) {
  // ── Reminders ──────────────────────────────────────────────────────────

  const reminders = new Map();
  let reminderId = 0;

  bruce.registerFunction(
    'set_reminder',
    'Set a timed reminder. Bruce will speak the reminder after the specified delay. For example "remind me to add hops in 10 minutes" or "remind me to check the mash in 1 hour and 30 minutes".',
    {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'What to remind the user about' },
        hours: { type: 'number', description: 'Hours from now (default 0)' },
        minutes: { type: 'number', description: 'Minutes from now (default 0)' },
        seconds: { type: 'number', description: 'Seconds from now (default 0)' },
      },
      required: ['message'],
    },
    async ({ message, hours = 0, minutes = 0, seconds = 0 }) => {
      const totalMs = Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
      if (totalMs <= 0) return 'Please specify a time in the future for the reminder.';

      const id = ++reminderId;
      const timer = setTimeout(() => {
        reminders.delete(id);
        console.log(`[Bruce] Reminder fired: ${message}`);
        bruce.speak(`[SYSTEM] A scheduled reminder has fired. You MUST say the following reminder out loud to the user, word for word. Do not say anything else, no greetings, no follow-ups. Just deliver the reminder: "${message}"`);
      }, totalMs);
      reminders.set(id, { message, timer });

      const parts = [];
      if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
      if (minutes > 0) parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);
      if (seconds > 0) parts.push(`${seconds} second${seconds !== 1 ? 's' : ''}`);
      return `Reminder set: "${message}" in ${parts.join(' and ')}.`;
    }
  );

  // ── Dilution calculator ────────────────────────────────────────────────

  bruce.registerFunction(
    'dilution_calculator',
    'Calculate how much water to add to wort to reach a target gravity. Requires the current wort volume in litres, the current gravity (OG), and the desired gravity (DG). Gravity can be given as e.g. 1.050 or just 1050. The desired gravity must be lower than the current gravity.',
    {
      type: 'object',
      properties: {
        volume: { type: 'number', description: 'Current wort volume in litres' },
        current_gravity: { type: 'number', description: 'Current/original gravity, e.g. 1.050 or 1050' },
        desired_gravity: { type: 'number', description: 'Target gravity after dilution, e.g. 1.040 or 1040' },
      },
      required: ['volume', 'current_gravity', 'desired_gravity'],
    },
    async ({ volume, current_gravity, desired_gravity }) => {
      let og = current_gravity > 1.2 ? current_gravity / 1000 : current_gravity;
      let dg = desired_gravity > 1.2 ? desired_gravity / 1000 : desired_gravity;

      if (volume <= 0) return 'Volume must be greater than zero.';
      if (og <= 1) return 'Current gravity must be greater than 1.000.';
      if (dg <= 1) return 'Desired gravity must be greater than 1.000.';
      if (dg >= og) return 'Desired gravity must be lower than the current gravity.';

      const newVolume = (volume * (og - 1)) / (dg - 1);
      const waterToAdd = newVolume - volume;

      return `You need to add ${waterToAdd.toFixed(1)} litres of water. That brings the total volume to ${newVolume.toFixed(1)} litres and the gravity from ${og.toFixed(3)} down to ${dg.toFixed(3)}.`;
    }
  );

  // ── Hydrometer temperature adjustment ──────────────────────────────────

  bruce.registerFunction(
    'hydrometer_correction',
    'Correct a hydrometer specific-gravity reading for the difference between the sample temperature and the hydrometer\'s calibration temperature. Gravity can be given as e.g. 1.050 or 1050. Calibration temperature defaults to 20°C if not provided.',
    {
      type: 'object',
      properties: {
        reading: { type: 'number', description: 'Hydrometer reading (specific gravity), e.g. 1.050 or 1050' },
        sample_temp: { type: 'number', description: 'Temperature of the sample in °C' },
        calibration_temp: { type: 'number', description: 'Calibration temperature of the hydrometer in °C (default 20)' },
      },
      required: ['reading', 'sample_temp'],
    },
    async ({ reading, sample_temp, calibration_temp = 20 }) => {
      const sg = reading > 1.2 ? reading / 1000 : reading;
      if (sg <= 0) return 'Hydrometer reading must be greater than zero.';

      const toF = (c) => c * 9 / 5 + 32;
      const adj = (tF) =>
        (1.313454 - 0.132674 * tF + 0.002057793 * tF * tF - 0.000002627634 * tF * tF * tF) * 0.001;

      const corrected = sg + adj(toF(sample_temp)) - adj(toF(calibration_temp));

      return `The corrected gravity is ${corrected.toFixed(3)} (read ${sg.toFixed(3)} at ${sample_temp}°C, calibrated for ${calibration_temp}°C).`;
    }
  );
}

module.exports = { register };
