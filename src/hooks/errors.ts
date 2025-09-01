const catchErrors = () => {
  process.on('uncaughtException', async (err) => {
    console.log(`Caught exception at ${new Date()}: ${err}`)
    console.log('Stack trace:', err.stack)
  })
}

export { catchErrors }
