const express = require('express');
const cors = require('cors');
require('dotenv').config();
const app = express()
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = process.env.PORT

app.use(cors());
app.use(express.json());


const uri = process.env.MONGODB_URI;
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});
async function run() {
    try {

        await client.connect();

        const database = client.db('skillswap')
        const taskscollection = database.collection('tasks')
        const proposalscollection = database.collection('proposals') 

        await client.db("admin").command({ ping: 1 });

        app.post('/api/tasks', async (req, res) => {
            const task = req.body
            task.createdAt = new Date();
            const result = await taskscollection.insertOne(task)
            res.send(result)
        })
        app.get('/api/tasks', async (req, res) => {
            const query = {}
            if (req.query.clientId) {
                query.clientId = req.query.clientId
            }
            const result = await taskscollection.find(query).toArray()
            res.send(result)
        })
        app.get('/api/all-tasks', async (req,res) => {
            const result = await taskscollection.find().toArray()
            res.send(result)
        })
        app.get('/api/tasks/:id', async (req, res) => {
            const { id } = req.params
            const result = await taskscollection.findOne({ _id: new ObjectId(id) })
            res.send(result)
        })
        app.delete('/api/tasks/:id', async (req, res) => {
            const { id } = req.params
            const query = { _id: new ObjectId(id) }
            const result = await taskscollection.deleteOne(query)
            res.send(result)
        })

        app.patch('/api/tasks/:id', async (req, res) => {
            try {
                const { id } = req.params;
                const updateData = req.body;
                delete updateData._id;
                delete updateData.status;

                const result = await taskscollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: updateData }
                );

                res.send(result);
            } catch (error) {
                console.error("Error updating task:", error);
                res.status(500).send({ success: false, message: "Internal server error" });
            }
        });


        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('Hello World!')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})