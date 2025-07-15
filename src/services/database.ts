import mongoose from 'mongoose';

export const connectToDatabase = async () => {
    try {
        const dbURI = process.env.DB_URI;
        if (!dbURI) {
            throw new Error('DB_URI environment variable is not set.');
        }

        await mongoose.connect(dbURI);

        await mongoose.connection.db?.admin().command({ ping: 1 });
        console.log('Database connected!');
    } catch (err) {
        console.error('Error connecting to MongoDB:', err);
        // Set exit code to 1 for graceful shutdown in case of database connection error
        process.exitCode = 1;
    }
}; 