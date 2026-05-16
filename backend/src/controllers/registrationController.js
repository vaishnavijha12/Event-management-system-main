import Registration from '../models/Registration.js';
import Event from '../models/Event.js';
import { generateQRCodeDataUrl } from '../utils/qrcode.js';
import { sendEmail } from '../utils/email.js';
import { createObjectCsvWriter } from 'csv-writer';
import path from 'path';

export const registerForEvent = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event || event.status !== 'approved') return res.status(400).json({ message: 'Event not available' });
    const payload = JSON.stringify({ userId: req.user.id, eventId: event._id, at: Date.now() });
    const qrCodeDataUrl = await generateQRCodeDataUrl(payload);
    
    // Current implementation includes : 
    // Checks for an existing cancelled registration
    // Reactivating the existing registration instead of inserting a new record
    // Capacity validation on event registration
    // Keeps the audit trail intact while avoiding unique index conflicts

    // Check active registration
    const activeRegistrations = await Registration.countDocuments({
      event: req.params.id,
      status: { $ne: "cancelled" },
    });

    // Capacity validation
    if (activeRegistrations>=event.capacity && event.capacity>0){
      return res.status(400).json({
        message:"Event is fully booked"
      })
    }

    // To reinitiate the existing registered event
    const existingRegistration = await Registration.findOne({user:req.user.id,event:req.params.id});

    if (existingRegistration){
      if (existingRegistration.status==="cancelled"){
          existingRegistration.status = 'registered';
      }

      await existingRegistration.save();
      try {
        await sendEmail({ to: req.user.email, subject: `Registered: ${event.title}`, html: `<p>You are registered for ${event.title}.</p>` });
      } catch (_) { }

      return res.status(201).json({
        registration:existingRegistration,
      })
    }

    else{
      const reg = await Registration.create({ user: req.user.id, event: event._id, qrCodeDataUrl });
      try {
        await sendEmail({ to: req.user.email, subject: `Registered: ${event.title}`, html: `<p>You are registered for ${event.title}.</p>` });
      } catch (_) { }

      res.status(201).json({ registration: reg });
    }

    
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const myRegistrations = async (req, res) => {
  try {
    const regs = await Registration.find({ user: req.user.id }).populate('event');
    res.json({ registrations: regs });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const participantsForEvent = async (req, res) => {
  try {
    const regs = await Registration.find({ event: req.params.id }).populate('user', 'name email');
    res.json({ participants: regs });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const checkInParticipant = async (req, res) => {
  try {
    const status = req.body.status || 'attended';
    const reg = await Registration.findOneAndUpdate(
      { user: req.body.userId, event: req.params.id },
      { status: status, checkedInAt: status === 'attended' ? new Date() : undefined },
      { new: true }
    );
    if (!reg) return res.status(404).json({ message: 'Registration not found' });
    res.json({ registration: reg });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const exportParticipantsCsv = async (req, res) => {
  try {
    const regs = await Registration.find({ event: req.params.id }).populate('user', 'name email');
    const rows = regs.map(r => ({ name: r.user?.name || '', email: r.user?.email || '', status: r.status, registeredAt: r.createdAt }));
    const filePath = path.join(process.cwd(), `participants-${req.params.id}.csv`);
    const csvWriter = createObjectCsvWriter({
      path: filePath,
      header: [
        { id: 'name', title: 'Name' },
        { id: 'email', title: 'Email' },
        { id: 'status', title: 'Status' },
        { id: 'registeredAt', title: 'Registered At' },
      ],
    });
    await csvWriter.writeRecords(rows);
    res.download(filePath);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const checkRegistrationStatus = async (req, res) => {
  try {
    const registration = await Registration.findOne({ user: req.user.id, event: req.params.id });
    res.json({ isRegistered: !!registration });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


export const cancelRegistration = async (req, res) => {
  // Current implementation includes :
  // Only the customer who owns the registration can cancel it
  // Cannot cancel if event.date is in the past (past event check)
  // Sets registration.status = 'cancelled'; does not delete the document (for audit trail)
  
  try {
    const { id } = req.params;
    const userId = req.user.id; // from auth middleware

    const registration = await Registration.findById(id)
      .populate("event");

    if (!registration) {
      return res.status(404).json({
        message: "Registration not found",
      });
    }

    // Owner check
    if (registration.user.toString() !== userId) {
      return res.status(403).json({
        message: "Unauthorized",
      });
    }

    // Already cancelled
    if (registration.status === "cancelled") {
      return res.status(400).json({
        message: "Already cancelled",
      });
    }

    // Past event check
    const eventDate = new Date(registration.event.date);

    if (eventDate < new Date()) {
      return res.status(400).json({
        message: "Cannot cancel past events",
      });
    }

    registration.status = "cancelled";
    await registration.save();

    res.status(200).json({
      message: "Registration cancelled successfully",
      registration,
    });

  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};


