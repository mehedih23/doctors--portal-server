const express = require('express')
const cors = require('cors');
const jwt = require('jsonwebtoken');
const app = express()
const port = process.env.PORT || 5000
require('dotenv').config()
const { MongoClient, ServerApiVersion } = require('mongodb');

app.use(cors());
app.use(express.json());

// root api //
app.get('/', (req, res) => {
    res.send('Welcome To Doctors Portal.')
})


function VerifyJWT(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send({ message: 'Unauthorized User' });
    }
    const token = authHeader.split(' ')[1]
    jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: 'Forbidden Access' });
        }
        req.decoded = decoded;
        next();
    });
}


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@doctors-portal-cluster.tenaw.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });


async function run() {
    try {
        await client.connect();
        const serviceCollection = client.db("doctors-portal").collection("services");
        const bookingCollection = client.db("doctors-portal").collection("booking");
        const userCollection = client.db("doctors-portal").collection("users");
        const doctorCollection = client.db("doctors-portal").collection("doctors");


        const verifyAdmin = async (req, res, next) => {
            const requester = req.decoded.email;
            const requesterAccount = await userCollection.findOne({ email: requester });
            if (requesterAccount.role === 'admin') {
                next();
            }
            else {
                res.status(403).send({ message: 'Forbidden' });
            }
        }


        // insert user //
        app.put('/user/:email', async (req, res) => {
            const email = req.params.email;
            const user = req.body;
            const filter = { email: email };
            const options = { upsert: true };
            const updateDoc = { $set: user };
            const result = await userCollection.updateOne(filter, updateDoc, options);
            const token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN, { expiresIn: '1d' })
            res.send({ result, token });
        })

        // Make Admin //
        app.put('/user/admin/:email', VerifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const filter = { email: email };
            const updateDoc = {
                $set: { role: 'admin' }
            };
            const result = await userCollection.updateOne(filter, updateDoc);
            res.send(result);
        })


        // Verify user or not //
        app.get('/admin/:email', async (req, res) => {
            const email = req.params.email;
            const user = await userCollection.findOne({ email: email });
            const isAdmin = user.role === 'admin';
            res.send({ admin: isAdmin });

        });

        // Get All User //
        app.get('/users', VerifyJWT, async (req, res) => {
            const users = await userCollection.find().toArray();
            res.send(users);
        })

        // get all services from database //
        app.get('/service', async (req, res) => {
            const query = {};
            const cursor = serviceCollection.find(query).project({ name: 1 });
            const service = await cursor.toArray();
            res.send(service);
        })

        // Get available slots //
        app.get('/available', async (req, res) => {
            const date = req.query.date;
            const services = await serviceCollection.find().toArray();

            const query = { date: date };
            const bookings = await bookingCollection.find(query).toArray();

            services.forEach(service => {
                const booking = bookings.filter(book => book.treatmentName === service.name);
                const book = booking.map(book => book.time);
                const available = service.slots.filter(booked => !book.includes(booked));
                service.slots = available;
            })
            res.send(services)
        })


        // post booking data & filter by date //
        app.post('/booking', async (req, res) => {
            const info = req.body;
            const query = { email: info?.email, treatmentName: info?.treatmentName, date: info?.date };
            const exists = await bookingCollection.findOne(query);
            if (exists) {
                return res.send({ success: false, booking: exists });
            }
            else {
                const result = await bookingCollection.insertOne(info);
                return res.send({ success: true, booking: result })
            }
        })

        // get all appointments by user //
        app.get('/myappointment', VerifyJWT, async (req, res) => {
            const email = req.query.email;
            const decodedEmail = req.decoded.email;
            if (email === decodedEmail) {
                const query = { email: email }
                const allAppointment = await bookingCollection.find(query).toArray();
                return res.send(allAppointment);
            }
            else {
                return res.status(403).send({ message: 'Forbidden Access' })
            }
        });


        // Add Doctor to the database //
        app.post('/doctor', VerifyJWT, verifyAdmin, async (req, res) => {
            const doctor = req.body;
            const result = await doctorCollection.insertOne(doctor);
            res.send(result);
        })

        // Get All Doctors //
        app.get('/doctor', VerifyJWT, verifyAdmin, async (req, res) => {
            const doctors = await doctorCollection.find().toArray();
            res.send(doctors);
        })

        // Delete a doctor //
        app.delete('/doctor/:email', VerifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const filter = { doctorMail: email };
            const doctor = await doctorCollection.deleteOne(filter);
            res.send(doctor);
        })


    }
    finally {
        // await client.close();
    }
}
run().catch(console.dir);




app.listen(port, () => {
    console.log(`Running in http://localhost:${port}`)
})