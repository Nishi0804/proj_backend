const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const bodyParser = require('body-parser');
const http = require("http");
const { Server } = require("socket.io");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI("AIzaSyAl-k30fenpNfcnkl1mmCeYRJzvALGH0Gk");
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.json());

mongoose.connect(process.env.MONGO)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

const personalInfoSchema = new mongoose.Schema({
  firstName: { type: String, required: true },
  middleName: { type: String },
  lastName: { type: String, required: true },
  age: { type: Number, required: true },
  bloodGroup: { type: String, required: true },
  flatNo: { type: String, required: true },
  area: { type: String, required: true },
  landmark: { type: String },
  pincode: { type: String, required: true },
  city: { type: String, required: true },
  email: { type: String, required: true },
  insuranceNumber: { type: String },
  height: { type: Number },
  heightUnit: { type: String, enum: ['cm', 'feet'] },
  weight: { type: Number },
  weightUnit: { type: String, enum: ['kg', 'lb'] },
  allergies: { type: String },
  medication: { type: String },
  createdAt: { type: Date, default: Date.now }
});


const userSchema = new mongoose.Schema({
  fullName: String,
  dob: {
    day: String,
    month: String,
    year: String
  },
  gender: String,
  mobileNumber: String,
  email: { type: String, unique: true },
  pin: String,
  emergencyContacts: [
    {
      fullName: String,
      relation: String,
      contactNumber: String,
    }
  ],
  hostedEvents: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Event' }],

  personalInfo: personalInfoSchema
});

userSchema.pre('save', async function (next) {
  if (!this.isModified('pin')) return next();
  const salt = await bcrypt.genSalt(10);
  this.pin = await bcrypt.hash(this.pin, salt);
  next();
});

userSchema.methods.comparePin = async function (inputPin) {
  return await bcrypt.compare(inputPin, this.pin);
};

const User = mongoose.model('User', userSchema);

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  socket.on("chat message", (data) => {
    const { name, message } = data;
    console.log("Message received from:", name, "Message:", message);

    io.emit("chat message", { name, message });
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});


app.post('/signup', async (req, res) => {
  try {
    const { fullName, dob, gender, mobileNumber, email, pin } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'Email already in use' });
    }

    const newUser = new User({ fullName, dob, gender, mobileNumber, email, pin });
    await newUser.save();

    const token = jwt.sign({ userId: newUser._id }, process.env.JWT_SECRET);

    res.status(201).json({ message: 'User created successfully', token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { email, mobileNumber, pin, otp } = req.body;

    if (email) {
      const user = await User.findOne({ email });
      if (!user) return res.status(404).json({ message: 'User not found' });

      const isValidPin = await user.comparePin(pin);
      if (!isValidPin) return res.status(401).json({ message: 'Invalid credentials' });

      const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET);
      return res.status(200).json({ message: 'Login successful', token });
    }

    if (mobileNumber) {
      const user = await User.findOne({ mobileNumber });
      if (!user) return res.status(404).json({ message: 'User not found' });

      const isValidPin = await user.comparePin(pin);
      if (!isValidPin) return res.status(401).json({ message: 'Invalid credentials' });

      const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET);
      return res.status(200).json({ message: 'Login successful', token });
    }

    return res.status(400).json({ message: 'Invalid login method' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'No token provided' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (error) {
    console.error("JWT verification failed:", error);
    return res.status(403).json({ message: 'Failed to authenticate token' });
  }
};


app.get('/api/user/account', verifyToken, async (req, res) => {
  try {
    const userId = req.userId;
    const user = await User.findById(userId)
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.put('/api/user/update-password', verifyToken, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const userId = req.userId;

  try {
    const user = await User.findById(userId);
    console.log("userfound")
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.pin);
    if (!isMatch) {
      return res.status(400).json({ message: 'Incorrect current password' });
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    await user.save();

    res.status(200).json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.post('/nominee', verifyToken, async (req, res) => {
  try {
    const { fullName, relation, contactNumber } = req.body;
    const userId = req.userId;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const newContact = { fullName, relation, contactNumber };
    user.emergencyContacts.push(newContact);

    await user.save();

    res.status(201).json({ message: 'Emergency contact added successfully', emergencyContacts: user.emergencyContacts });
  } catch (error) {
    console.error('Error adding nominee:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

const crisisSchema = new mongoose.Schema({
  desc: String,
  fullName: String,
  time: String,
  date: String,
  cords: [Number]
});
const Crisis = mongoose.model('Crisis', crisisSchema);

app.post("/crisis", async (req, res) => {
  try {
    const { desc, fullName, time, date, cords } = req.body;
    if (!cords || cords.length !== 2) {
      return res.status(400).json({ message: "Coordinates must be an array of two numbers [longitude, latitude]" });
    }
    const newCrisis = new Crisis({ desc, fullName, time, date, cords });
    await newCrisis.save();
    res.status(201).json({ message: "Crisis saved successfully", crisis: newCrisis });
  } catch (error) {
    console.error("Error saving crisis:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.get('/gethist', verifyToken, async (req, res) => {
  const { _id } = req.query;

  console.log(_id);
  try {
    const historyData = await Crisis.find({ _id });
    if (!historyData.length) {
      return res.status(404).json({ message: "No documents found" });
    }
    res.json(historyData);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/crises", async (req, res) => {
  try {
    const crises = await Crisis.find({});
    res.status(200).json(crises);
  } catch (error) {
    console.error("Error fetching crises:", error);
    res.status(500).json({ message: "Error fetching crises" });
  }
});

const eventSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  date: { type: Date, required: true },
  location: { type: String, required: true },
  skillsRequired: { type: String },
  volunteers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User ' }],
  host: { type: mongoose.Schema.Types.ObjectId, ref: 'User ', required: true }
});

const Event = mongoose.model('Event', eventSchema);

app.get("/events", async (req, res) => {
  try {
    const events = await Event.find({});
    res.status(200).json(events);
  } catch (error) {
    console.error("Error fetching events:", error);
    res.status(500).json({ message: "Error fetching events" });
  }
});

app.post('/create', verifyToken, async (req, res) => {
  const { title, description, date, location, skillsRequired } = req.body;
  const userId = req.userId;

  try {
    const newEvent = new Event({
      title,
      description,
      date,
      location,
      skillsRequired,
      volunteers: [],
      host: userId
    });

    await newEvent.save();

    await User.findByIdAndUpdate(userId, { $push: { hostedEvents: newEvent._id } });

    res.status(201).json({ message: 'Event created successfully', event: newEvent });
  } catch (error) {
    console.error('Error creating event:', error);
    res.status(500).json({ message: 'Error creating event', error });
  }
});

app.post('/:eventId/volunteer', async (req, res) => {
  const { eventId } = req.params;
  const userId = req.userId;
  console.log(userId);

  try {
    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ message: 'Event not found' });

    if (!event.volunteers.includes(userId)) {
      event.volunteers.push(userId);
      await event.save();
    }

    res.json({ message: 'User  added as volunteer', event });
  } catch (error) {
    console.error('Error volunteering for event:', error);
    res.status(500).json({ message: 'Error volunteering for event', error });
  }
});

app.get('/hosted-events', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.userId).populate('hostedEvents');
    if (!user) {
      return res.status(404).json({ message: 'User  not found' });
    }
    res.status(200).json(user.hostedEvents);
  } catch (error) {
    console.error("Error fetching hosted events:", error);
    res.status(500).json({ message: "Error fetching hosted events" });
  }
});

app.post('/userevents', async (req, res) => {
  const userId = req.body.userId;

  try {
    const userEvents = await Event.find({ volunteers: userId });

    if (userEvents.length === 0) {
      return res.status(404).json({ message: "No events found for this user." });
    }

    return res.status(200).json(userEvents);
  } catch (error) {
    console.error('Error fetching events:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.delete('/events/:eventId', verifyToken, async (req, res) => {
  const { eventId } = req.params;

  try {
    const event = await Event.findByIdAndDelete(eventId);
    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }
    res.status(200).json({ message: 'Event deleted successfully' });
  } catch (error) {
    console.error("Error deleting event:", error);
    res.status(500).json({ message: "Error deleting event" });
  }
});

app.post('/personal-info', verifyToken, async (req, res) => {
  try {
    const userId = req.userId;
    const personalInfoData = req.body;

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { personalInfo: personalInfoData },
      { new: true, upsert: true }
    );

    res.status(200).json({
      message: 'Personal Information updated successfully',
      personalInfo: updatedUser.personalInfo
    });
  } catch (error) {
    console.error('Error updating personal info:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


app.get('/personal-info', verifyToken, async (req, res) => {
  try {
    const userId = req.userId;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.status(200).json({
      personalInfo: user.personalInfo || null
    });
  } catch (error) {
    console.error('Error fetching personal info:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.get('/news', async (req, res) => {
  try {
    const response = await axios.get('https://newsapi.org/v2/everything', {
      params: {
        q: '"India" AND ("disaster management" OR "natural disaster" OR "emergency response" OR "disaster relief" OR "crisis management")',
        language: 'en',
        sortBy: 'publishedAt',
        apiKey: process.env.NEWSAPI,
      },
    });
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

app.delete('/personal-info/delete', verifyToken, async (req, res) => {
  const userId = req.userId;
  try {
    await User.updateOne({ _id: userId }, { $unset: { personalInfo: "" } });
    res.status(200).send({ message: "Personal info deleted successfully" });
  } catch (error) {
    res.status(500).send({ message: "Error deleting personal info", error });
  }
});

app.post('/personal-info/update', verifyToken, async (req, res) => {
  try {
    const userId = req.userId;
    const personalInfoData = req.body;

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { personalInfo: personalInfoData },
      { new: true, upsert: true }
    );

    res.status(200).json({
      message: 'Personal Information updated successfully',
      personalInfo: updatedUser.personalInfo
    });
  } catch (error) {
    console.error('Error updating personal info:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.post("/chatbot", async (req, res) => {
  try {
    const userMessage = req.body.message;

    const systemMessage = `
      You are a safety and security assistant. Provide only general advice related to safety, security, and self-help in a crisis. 
      Limit your response to 1-2 sentences and focus on how the user can help themselves until help arrives. 
      Avoid giving medical advice or personal emergency assistance.
    `;

    const prompt = `${systemMessage}\nUser: ${userMessage}\nAssistant:`;

    const result = await model.generateContent(prompt);

    res.json({ reply: result.response.text() });
  } catch (error) {
    console.error("Error during chatbot request:", error);
    res.status(500).send("Error communicating with chatbot");
  }
});


app.post("/sms", async (req, res) => {
  const no = req.body.no;
  const msg = req.body.msg;

  const whatsappLink = `https://wa.me/91${no}?text=${encodeURIComponent(msg)}`;
  res.json({ whatsappLink });
});



server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
