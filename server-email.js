const express = require('express');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;
const adminPassword = process.env.ADMIN_PASSWORD || 'changeme';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || "587"),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const reservations = [];
const blockedSlots = [];

function generateTimeSlots(date) {
  const slots = [];
  const dayOfWeek = date.getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return slots;
  }
  for (let hour = 10; hour < 19; hour++) {
    const start = new Date(date);
    start.setHours(hour, 0, 0, 0);
    const end = new Date(date);
    end.setHours(hour + 1, 0, 0, 0);
    slots.push({ start, end });
  }
  return slots;
}

app.use(bodyParser.json());

app.get('/api/slots', (req, res) => {
  const { date } = req.query;
  if (!date) {
    return res.status(400).json({ error: 'Date manquante' });
  }
  const selectedDate = new Date(date);
  const slots = generateTimeSlots(selectedDate);
  const available = slots.filter(slot => {
    const isBlocked = blockedSlots.some(b => b.start.getTime() === slot.start.getTime());
    const isReserved = reservations.some(r => r.start.getTime() === slot.start.getTime());
    return !isBlocked && !isReserved;
  });
  res.json(available.map(slot => ({
    start: slot.start.toISOString(),
    end: slot.end.toISOString(),
  })));
});

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
  })));
});

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

app.post('/api/reservations', (req, res) => {
  const { start, name, prenom, adresse, telephone } = req.body;
  if (!start || !name || !prenom || !adresse || !telephone) {
    return res.status(400).json({ error: 'Informations manquantes' });
  }
  const slotStart = new Date(start);
  const slot = { start: slotStart, end: new Date(slotStart.getTime() + 60 * 60 * 1000) };
  const isBlocked = blockedSlots.some(b => b.start.getTime() === slot.start.getTime());
  const isReserved = reservations.some(r => r.start.getTime() === slot.start.getTime());
  if (isBlocked || isReserved) {
    return res.status(400).json({ error: 'Créneau indisponible' });
  }
  reservations.push({ ...slot, name, prenom, adresse, telephone });

  const adminEmail = process.env.ADMIN_EMAIL;
  if (adminEmail) {
    const mailOptions = {
      from: process.env.SMTP_USER,
      to: adminEmail,
      subject: 'Nouvelle réservation',
      text: `Une nouvelle réservation vient d'\u00eatre enregistrée:\n\nDate: ${slotStart.toLocaleString()}\nNom: ${name}\nPrénom: ${prenom}\nAdresse: ${adresse}\nTéléphone: ${telephone}`,
    };
    transporter.sendMail(mailOptions).catch((err) => {
      console.error("Erreur lors de l'envoi de l'email:", err);
    });
  }

  res.json({ message: 'Réservation confirmée' });
});

app.post('/api/block', (req, res) => {
  const { start } = req.body;
  const key = req.headers['x-admin-key'];
  if (key !== adminPassword) {
    return res.status(401).json({ error: 'Accès refusé' });
  }
  const slotStart = new Date(start);
  blockedSlots.push({ start: slotStart, end: new Date(slotStart.getTime() + 60 * 60 * 1000) });
  res.json({ message: 'Créneau bloqué' });
});

app.post('/api/unblock', (req, res) => {
  const { start } = req.body;
  const key = req.headers['x-admin-key'];
  if (key !== adminPassword) {
    return res.status(401).json({ error: 'Accès refusé' });
  }
  const slotStart = new Date(start);
  const index = blockedSlots.findIndex(b => b.start.getTime() === slotStart.getTime());
  if (index !== -1) {
    blockedSlots.splice(index, 1);
  }
  res.json({ message: 'Créneau débloqué' });
});

app.use(express.static('public'));

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.listen(port, () => {
  console.log(`Serveur lancé sur le port ${port}`);
});
