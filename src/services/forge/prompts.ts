export const TASK_SHOT_EXAMPLES = [
  {
    task_prompt: 'Find a hotel in Paris',
    app: {
      type: 'website',
      name: 'Booking.com',
      url: 'booking.com'
    },
    conversation: [
      {
        role: 'user',
        content: 'Task: Find a hotel in Paris\nApp: Booking.com (website, URL: booking.com)'
      },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_123',
            type: 'function',
            function: {
              name: 'validate_task_request',
              arguments: JSON.stringify({
                title: 'Find Paris hotel',
                app: 'Booking.com',
                icon_url: 'https://s2.googleusercontent.com/s2/favicons?domain=booking.com&sz=64',
                objectives: [
                  'Open <app>Booking.com</app> website in your browser',
                  'Search for Paris hotels',
                  'Apply filters for dates and preferences',
                  'View hotel details and reviews'
                ],
                content:
                  'Hi! I need to find a hotel in Paris for my upcoming trip. Can you help me search on Booking.com?'
              })
            }
          }
        ]
      },
      {
        role: 'tool',
        tool_call_id: 'call_123',
        content: 'accepted'
      },
      {
        role: 'user',
        content:
          "Sure! I'll help you find a hotel in Paris. Let's start by going to booking.com and entering your travel dates. When are you planning to visit?"
      }
    ]
  },
  {
    task_prompt: 'Order sushi delivery',
    app: {
      type: 'website',
      name: 'Uber Eats',
      url: 'ubereats.com'
    },
    conversation: [
      {
        role: 'user',
        content: 'Task: Order sushi delivery\nApp: Uber Eats (website, URL: ubereats.com)'
      },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_456',
            type: 'function',
            function: {
              name: 'validate_task_request',
              arguments: JSON.stringify({
                title: 'Order sushi delivery',
                app: 'Uber Eats',
                icon_url: 'https://s2.googleusercontent.com/s2/favicons?domain=ubereats.com&sz=64',
                objectives: [
                  'Open <app>Uber Eats</app> website in your browser',
                  'Find nearby sushi restaurants',
                  'Select items and customize order',
                  'Review cart before checkout'
                ],
                content:
                  "Hi! I'm hungry and want to order some sushi from Uber Eats. Can you show me how?"
              })
            }
          }
        ]
      },
      {
        role: 'tool',
        tool_call_id: 'call_456',
        content: 'accepted'
      },
      {
        role: 'user',
        content:
          "I'll help you order sushi through Uber Eats! First, let's check which sushi restaurants deliver to your location. Could you open ubereats.com and enter your delivery address?"
      }
    ]
  },
  {
    task_prompt: 'Find tennis shoes on sale',
    app: {
      type: 'website',
      name: 'eBay',
      url: 'ebay.com'
    },
    conversation: [
      {
        role: 'user',
        content: 'Task: Find tennis shoes on sale\nApp: eBay (website, URL: ebay.com)'
      },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_789',
            type: 'function',
            function: {
              name: 'validate_task_request',
              arguments: JSON.stringify({
                title: 'Find tennis shoes',
                app: 'eBay',
                icon_url: 'https://s2.googleusercontent.com/s2/favicons?domain=ebay.com&sz=64',
                objectives: [
                  'Open <app>eBay</app> website in your browser',
                  'Search for tennis shoes',
                  'Apply filters for size and price',
                  'Sort and compare listings'
                ],
                content:
                  "Hi! I want to buy some tennis shoes on eBay. I've never used the site before - can you help me find a good deal?"
              })
            }
          }
        ]
      },
      {
        role: 'tool',
        tool_call_id: 'call_789',
        content: 'accepted'
      },
      {
        role: 'user',
        content:
          "I'll help you find tennis shoes on eBay! Let's start by going to ebay.com. Do you have a specific brand or size in mind?"
      }
    ]
  }
]

export const SYSTEM_PROMPT = `You are playing the role of someone who needs help with a specific computer task. You should act as a realistic user who is not tech-savvy but friendly and appreciative. Stay in character and express your needs naturally and casually.

Remember to:
- Keep your initial request brief and natural
- Show mild confusion if technical terms are used
- Express appreciation when helped
- Stay focused on your specific task
- Ask for clarification if needed
- When provided context, do a tool call where in the content you must say hi and ask for your task directly (e.g. "Hi! I need to install an ad-blocker in Chrome" rather than "Can you guide me on how to install an ad-blocker?")`
export const APP_TASK_GENERATION_PROMPT = `
You are designing natural task examples for desktop applications and web browsers that humans can demonstrate by screen recording to train AI computer use models in September 2025.  

### **CRITICAL:** Focus on demonstrable computer interactions, not AI-to-AI tasks
- Every task must be something a human can show by recording their screen
- Tasks should involve clicking, typing, navigating interfaces, not abstract concepts
- The goal is to teach AI models how to use computers like humans do

### **Instructions:**  
- Given a list of computer skills, generate **apps and their associated tasks** that naturally incorporate those skills.  
- Focus on **2025's popular platforms and modern interfaces** that users actually interact with.  
- Each app should have at least **5 tasks** representing **recordable desktop/browser interactions**.  
- Ensure **tasks align with the provided skills** and can be filmed step-by-step.
- IMPORTANT: Avoid using personal pronouns like "my" or "your" in task descriptions. Use neutral, general language.
- Be as exhaustive as possible, enumerating every relevant app and task given the input skill list.

### **Guidelines for Mapping Skills to Apps (Demonstrable 2025 Tasks):**  

#### **1. AI Chat Interfaces → Modern AI Platforms (ChatGPT, Claude, Perplexity, etc.)**
✅ **Examples:** ChatGPT web interface, Claude.ai, Perplexity.ai  
✅ **Tasks:**  
- "Navigate to ChatGPT Plus and create a new custom GPT using the interface."  
- "Upload a document to Claude.ai and ask it to summarize the content."  
- "Use Perplexity's search interface to research a topic with follow-up questions."  
- "Share a ChatGPT conversation link and adjust sharing settings."  
- "Switch between different AI models in the Claude interface dropdown."  

#### **2. Social Commerce Interfaces → Shopping Platforms (TikTok Shop, Instagram, YouTube, etc.)**
✅ **Examples:** TikTok Shop Creator Center, Instagram Business Suite, YouTube Studio  
✅ **Tasks:**  
- "Navigate TikTok Shop Creator Center to add a new product listing."  
- "Set up Instagram Shopping tags on a post using the mobile browser interface."  
- "Create a YouTube video with product shelves using YouTube Studio."  
- "Respond to customer messages in Instagram Business Suite inbox."  
- "Analyze sales metrics in the TikTok Shop analytics dashboard."  

#### **3. Modern Design Tools → Browser-Based Creation (Figma, Canva, Midjourney, etc.)**
✅ **Examples:** Figma web app, Canva browser interface, Midjourney Discord  
✅ **Tasks:**  
- "Create a new Figma project and design a mobile app mockup using components."  
- "Use Canva's browser interface to design social media templates."  
- "Generate images using Midjourney commands in the Discord web interface."  
- "Export designs from Figma in multiple formats using the export panel."  
- "Collaborate on a Canva design by sharing and adding comments."  

#### **4. Web3 Interfaces → DeFi Platforms (Uniswap, OpenSea, MetaMask, etc.)**
✅ **Examples:** Uniswap web interface, OpenSea marketplace, MetaMask browser extension  
✅ **Tasks:**  
- "Connect MetaMask wallet to Uniswap and swap tokens using the interface."  
- "Browse and filter NFTs on OpenSea marketplace using search tools."  
- "Add a new token to MetaMask wallet using the import function."  
- "List an NFT for sale on OpenSea by navigating the selling interface."  
- "Check transaction history in MetaMask browser extension popup."  

#### **5. Productivity Interfaces → Modern Work Tools (Notion, Linear, Obsidian, etc.)**
✅ **Examples:** Notion web app, Linear interface, Obsidian desktop app  
✅ **Tasks:**  
- "Create a new Notion database and set up custom properties and views."  
- "Use Linear's interface to create tickets and assign them to team members."  
- "Build a knowledge graph in Obsidian by linking notes and using graph view."  
- "Set up automated Notion templates and use them to create new pages."  
- "Track project progress in Linear using the roadmap and cycle views."  

#### **6. Social Platform Interfaces → 2025 Networks (X, Threads, Discord, etc.)**
✅ **Examples:** X.com (Twitter), Meta Threads, Discord desktop app  
✅ **Tasks:**  
- "Create and schedule posts on X.com using the composer interface."  
- "Navigate Threads web interface to reply to posts and manage followers."  
- "Set up a new Discord server using the server creation wizard."  
- "Use X's analytics dashboard to review post performance metrics."  
- "Moderate a Discord channel by managing roles and permissions."  

### **Output Format (JSON object):**  
Output format should be a JSON object with the following structure:
{
  "name": "Concise Agent Name", // e.g. "Email Manager Agent" instead of "Email Management Task Collection"
  "apps": [
    {
      "name": "App Name",
      "domain": "example.com",
      "description": "Brief service description",
      "categories": ["Category1", "Category2"],
      "tasks": [
        {
          "prompt": "Natural user request"
        }
      ]
    }
  ]
}

Example categories to consider:
- Desktop Applications
- Web Browsers
- Social Media Platforms
- E-commerce Interfaces
- Design Tools
- Productivity Software
- Communication Apps
- File Management
- Entertainment Platforms
- Educational Tools

Focus on creating tasks that feel like genuine user requests for recordable desktop interactions, similar to (but avoid personal pronouns):
- "Navigate to ChatGPT website and create a new custom GPT"
- "Use TikTok Shop interface to add product details and pricing"
- "Open MetaMask browser extension and connect to a DeFi website"
- "Create a design mockup in Figma using the component library"

<SKILLS>
{skill list}
</SKILLS>

Output only the JSON object with no additional text or explanation.`
