const express = require('express');
const bodyParser = require('body-parser');
const app = express();
const port = process.env.PORT || 3000;
const adminPassword = process.env.ADMIN_PASSWORD || 'changeme';

// Données en mémoire (à remplacer par une base de données pour la production)
const reservations = [];
const blockedSlots = [];

// Générer les créneaux du lundi au vendredi, de 10h à 19h
function generateTimeSlots(date) {
  const slots = [];
  const dayOfWeek = date.getDay(); // 0 = dimanche, 1 = lundi, ..., 6 = samedi
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return slots; // pas de créneaux le week-end
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

// Retourner les créneaux disponibles pour une date donnée (YYYY-MM-DD)
app.get('/api/slots', (req, res) => {
  const { date } = req.query;
  if (!date) {
    return res.status(400).json({ error: 'Date manquante' });
  }
  const selectedDate = new Date(date);
  const slots = generateTimeSlots(selectedDate);

  // filtre les créneaux bloqués ou déjà réservés
  const available = slots.filter(slot => {
    const isBlocked = blockedSlots.some(b =>
      b.start.getTime() === slot.start.getTime()
    );
    const isReserved = reservations.some(r =>
      r.start.getTime() === slot.start.getTime()
    );
    return !isBlocked && !isReserved;
  });

  res.json(available.map(slot => ({
    start: slot.start.toISOString(),
    end: slot.end.toISOString()
  })));
});

// Réserver un créneau
app.post('/api/reservations', (req, res) => {
  const { date, start, name, prenom, adresse, telephone } = req.body;
  if (!date || !start || !name || !prenom || !adresse || !telephone) {
    return res.status(400).json({ error: 'Informations manquantes' });
  }
  const slotStart = new Date(start);
  const slot = { start: slotStart, end: new Date(slotStart.getTime() + 60 * 60 * 1000) };
  // vérifie si libre
  const isBlocked = blockedSlots.some(b =>
    b.start.getTime() === slot.start.getTime()
  );
  const isReserved = reservations.some(r =>
    r.start.getTime() === slot.start.getTime()
  );
  if (isBlocked || isReserved) {
    return res.status(400).json({ error: 'Créneau indisponible' });
  }
  // enregistre la réservation
  reservations.push({ start: slot.start, end: slot.end, name, prenom, adresse, telephone });
  res.json({ message: 'Réservation confirmée' });
});

// Bloquer un créneau (admin)
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

// Débloquer un créneau (admin)
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

app.use(express.static('public')); // pour servir une page HTML si besoin

app.listen(port, () => {
  console.log(`Serveur lancé sur le port ${port}`);
});
