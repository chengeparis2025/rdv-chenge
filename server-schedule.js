const express = require('express');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;
const adminPassword = process.env.ADMIN_PASSWORD || 'changeme';

// Configure nodemailer using environment variables
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || "587", 10),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Email to notify when a reservation is made
const adminEmail = process.env.ADMIN_EMAIL;

// In-memory data storage (to be replaced by a database in production)
const reservations = [];
const blockedSlots = [];

// Middleware to parse JSON bodies
app.use(bodyParser.json());

// Serve static files from the public directory
app.use(express.static('public'));

// Generate time slots: 4-hour slots from 8h to 14h, Tuesday to Saturday
function generateTimeSlots(date) {
  const slots = [];
  const dayOfWeek = date.getDay(); // 0 = Sunday, 1 = Monday, 2 = Tuesday, ..., 6 = Saturday
  // Only allow Tuesday (2) to Saturday (6)
  if (dayOfWeek < 2 || dayOfWeek > 6) {
    return slots;
  }
  for (let hour = 8; hour <= 14; hour++) {
    const start = new Date(date);
    start.setHours(hour, 0, 0, 0);
    const end = new Date(date);
    end.setHours(hour + 4, 0, 0, 0);
    slots.push({ start, end });
  }
  return slots;
}

// Return available slots for a given date (YYYY-MM-DD)
app.get('/api/slots', (req, res) => {
  const { date } = req.query;
  if (!date) {
    return res.status(400).json({ error: 'Date manquante' });
  }
  const selectedDate = new Date(date);
  const slots = generateTimeSlots(selectedDate);
  // Filter slots that are blocked or already reserved
  const available = slots.filter(slot => {
    const isBlocked = blockedSlots.some(b => b.start.getTime() === slot.start.getTime());
    const isReserved = reservations.some(r => r.start.getTime() === slot.start.getTime());
    return !isBlocked && !isReserved;
  });
  res.json(available.map(s => ({ start: s.start.toISOString(), end: s.end.toISOString() })));
});

// Get all reservations (admin only)
app.get('/api/reservations', (req, res) => {
  const key = req.headers['x-admin-key'];
  if (key !== adminPassword) {
    return res.status(401).json({ error: 'Accès refusé' });
  }
  res.json(reservations.map(r => ({
    start: r.start.toISOString(),
    end: r.end.toISOString(),
    name: r.name,
    prenom: r.prenom,
    adresse: r.adresse,
    telephone: r.telephone,
    email: r.email,
  })));
});

// Get all blocked slots (admin only)
app.get('/api/blocked', (req, res) => {
  const key = req.headers['x-admin-key'];
  if (key !== adminPassword) {
    return res.status(401).json({ error: 'Accès refusé' });
  }
  res.json(blockedSlots.map(b => ({
    start: b.start.toISOString(),
    end: b.end.toISOString(),
  })));
});

// Create a reservation
app.post('/api/reservations', (req, res) => {
  const { date, start, name, prenom, adresse, telephone, email } = req.body;
  if (!date || !start || !name || !prenom || !adresse || !telephone || !email) {
    return res.status(400).json({ error: 'Informations manquantes' });
  }
  const slotStart = new Date(start);
  const slotEnd = new Date(slotStart.getTime() + 4 * 60 * 60 * 1000);
  // Ensure booking is made at least 2 days in advance
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = (slotStart - today) / (1000 * 60 * 60 * 24);
  if (diffDays < 2) {
    return res.status(400).json({ error: 'Vous devez réserver au moins deux jours à l\'avance' });
  }
  // Check if slot is blocked or already reserved
  const isBlocked = blockedSlots.some(b => b.start.getTime() === slotStart.getTime());
  const isReserved = reservations.some(r => r.start.getTime() === slotStart.getTime());
  if (isBlocked || isReserved) {
    return res.status(400).json({ error: 'Créneau indisponible' });
  }
  const reservation = { start: slotStart, end: slotEnd, name, prenom, adresse, telephone, email };
  reservations.push(reservation);
  // Send email notification to admin
  if (adminEmail && process.env.SMTP_USER && process.env.SMTP_PASS) {
    const mailOptions = {
      from: process.env.SMTP_USER,
      to: adminEmail,
      subject: 'Nouvelle réservation',
      text: `Une nouvelle réservation a été effectuée :\nDate : ${date}\nCréneau : ${slotStart.toLocaleString()} - ${slotEnd.toLocaleString()}\nNom : ${name}\nPrénom : ${prenom}\nAdresse : ${adresse}\nTéléphone : ${telephone}\nEmail : ${email}`,
    };
    transporter.sendMail(mailOptions).catch(err => {
      console.error('Erreur envoi email', err);
    });
  }
  res.json({ message: 'Réservation confirmée' });
});

// Block a single 4-hour slot (admin only)
app.post('/api/block', (req, res) => {
  const key = req.headers['x-admin-key'];
  if (key !== adminPassword) {
    return res.status(401).json({ error: 'Accès refusé' });
  }
  const { start } = req.body;
  if (!start) {
    return res.status(400).json({ error: 'Heure manquante' });
  }
  const startDate = new Date(start);
  const endDate = new Date(startDate.getTime() + 4 * 60 * 60 * 1000);
  const exists = blockedSlots.some(b => b.start.getTime() === startDate.getTime());
  if (!exists) {
    blockedSlots.push({ start: startDate, end: endDate });
  }
  res.json({ message: 'Créneau bloqué' });
});

// Unblock a single 4-hour slot (admin only)
app.post('/api/unblock', (req, res) => {
  const key = req.headers['x-admin-key'];
  if (key !== adminPassword) {
    return res.status(401).json({ error: 'Accès refusé' });
  }
  const { start } = req.body;
  if (!start) {
    return res.status(400).json({ error: 'Heure manquante' });
  }
  const startDate = new Date(start);
  const index = blockedSlots.findIndex(b => b.start.getTime() === startDate.getTime());
  if (index !== -1) {
    blockedSlots.splice(index, 1);
  }
  res.json({ message: 'Créneau débloqué' });
});

// Block a range of hours with multiple 4-hour slots (admin only)
app.post('/api/block-range', (req, res) => {
  const key = req.headers['x-admin-key'];
  if (key !== adminPassword) {
    return res.status(401).json({ error: 'Accès refusé' });
  }
  const { start, end } = req.body;
  if (!start || !end) {
    return res.status(400).json({ error: 'Heures de début et fin nécessaires' });
  }
  const rangeStart = new Date(start);
  const rangeEnd = new Date(end);
  for (let t = new Date(rangeStart); t <= rangeEnd; t = new Date(t.getTime() + 60 * 60 * 1000)) {
    const blockStart = new Date(t);
    const blockEnd = new Date(blockStart.getTime() + 4 * 60 * 60 * 1000);
    if (blockEnd > rangeEnd) {
      continue;
    }
    const exists = blockedSlots.some(b => b.start.getTime() === blockStart.getTime());
    if (!exists) {
      blockedSlots.push({ start: blockStart, end: blockEnd });
    }
  }
  res.json({ message: 'Plage bloquée' });
});

// Block an entire day (admin only)
app.post('/api/block-day', (req, res) => {
  const key = req.headers['x-admin-key'];
  if (key !== adminPassword) {
    return res.status(401).json({ error: 'Accès refusé' });
  }
  const { date } = req.body;
  if (!date) {
    return res.status(400).json({ error: 'Date nécessaire' });
  }
  const day = new Date(date);
  const slots = generateTimeSlots(day);
  slots.forEach(slot => {
    const exists = blockedSlots.some(b => b.start.getTime() === slot.start.getTime());
    if (!exists) {
      blockedSlots.push({ start: slot.start, end: slot.end });
    }
  });
  res.json({ message: 'Journée bloquée' });
});

// Block a date range inclusive (admin only)
app.post('/api/block-date-range', (req, res) => {
  const key = req.headers['x-admin-key'];
  if (key !== adminPassword) {
    return res.status(401).json({ error: 'Accès refusé' });
  }
  const { startDate, endDate } = req.body;
  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'Dates nécessaires' });
  }
  let current = new Date(startDate);
  const finalDate = new Date(endDate);
  while (current <= finalDate) {
    const slots = generateTimeSlots(current);
    slots.forEach(slot => {
      const exists = blockedSlots.some(b => b.start.getTime() === slot.start.getTime());
      if (!exists) {
        blockedSlots.push({ start: slot.start, end: slot.end });
      }
    });
    // Move to next day
    current = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1);
  }
  res.json({ message: 'Période bloquée' });
});

// Start the server
app.listen(port, () => {
  console.log(`Serveur lancé sur le port ${port}`);
});
