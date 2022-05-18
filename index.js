const express = require('express')
const cors = require('cors');
const jwt = require('jsonwebtoken');
const app = express()
const port = process.env.PORT || 5000
require('dotenv').config()
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)
// const nodemailer = require('nodemailer');
// const { createTransport } = require('nodemailer');

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
        const paymentCollection = client.db("doctors-portal").collection("payments");


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

        app.post('/create-payment-intent', VerifyJWT, async (req, res) => {
            const service = req.body;
            const price = service.treatmentPrice;
            const amount = price * 100;
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: "usd",
                payment_method_types: ['card']
            });
            res.send({ clientSecret: paymentIntent.client_secret })
        })


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
            const email = info?.email;
            const query = { email: info?.email, treatmentName: info?.treatmentName, date: info?.date };
            const exists = await bookingCollection.findOne(query);
            if (exists) {
                return res.send({ success: false, booking: exists });
            }
            else {
                const result = await bookingCollection.insertOne(info);
                // step 1
                /* let transporter = await createTransport({
                    service: 'gmail',
                    auth: {
                        user: 'papererkotha69@gmail.com',
                        password: 'wmuqondnizjcqtbj'
                    }
                });
                console.log(transporter);

                // step 2
                let mailOptions = {
                    from: 'papererkotha69@gmail.com',
                    to: 'mstsalmabegum450@gmail.com',
                    subject: 'Testing',
                    text: 'Hello'
                }
                console.log(mailOptions);
                // step 3
                transporter.sendMail(mailOptions, function (err, data) {
                    if (err) {
                        console.log('Error detect.')
                    } else {
                        console.log('successfully send.')
                    }
                }) */
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


        // get a single service for payment //
        app.get('/booking/:id', VerifyJWT, async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const result = await bookingCollection.findOne(query);
            res.send(result);
        })


        // Update booking //
        app.patch('/booking/:id', VerifyJWT, async (req, res) => {
            const id = req.params.id;
            const payment = req.body;
            const filter = { _id: ObjectId(id) };
            const updatedDoc = {
                $set: {
                    paid: true,
                    transactionId: payment.transactionId,
                }
            }
            const result = await paymentCollection.insertOne(payment)
            const updateBooking = await bookingCollection.updateOne(filter, updatedDoc);
            res.send(updatedDoc);
        })


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



// kiachejibonemehedivaikiachejibonemehedivai