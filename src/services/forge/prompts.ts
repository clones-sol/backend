export const TASK_SHOT_EXAMPLES = [
  {
    task_prompt: 'Create quarterly sales report by pulling data from CRM and analyzing trends',
    apps_used: [
      { name: 'Salesforce', domain: 'salesforce.com', description: 'CRM data source' },
      { name: 'Excel', domain: 'desktop', description: 'Data analysis and visualization' },
      { name: 'Outlook', domain: 'desktop', description: 'Email report to stakeholders' }
    ],
    conversation: [
      {
        role: 'user',
        content: 'Task: Create quarterly sales report by pulling data from CRM and analyzing trends\nApps: Salesforce (web: salesforce.com), Excel (desktop app), Outlook (desktop app)'
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
                title: 'Create quarterly sales report',
                app: 'Salesforce, Excel, Outlook',
                icon_url: 'https://s2.googleusercontent.com/s2/favicons?domain=salesforce.com&sz=64',
                objectives: [
                  'Open <app>Salesforce</app> and navigate to Reports section',
                  'Generate quarterly sales data export with filters for Q4 2025',
                  'Download sales data as CSV file to local desktop',
                  'Launch <app>Excel</app> desktop application',
                  'Import downloaded CSV into new Excel workbook',
                  'Create pivot tables to analyze sales trends by region and product',
                  'Generate charts showing quarterly performance metrics',
                  'Format report with company branding and executive summary',
                  'Save Excel file with descriptive filename',
                  'Open <app>Outlook</app> and compose new email to stakeholders',
                  'Attach formatted Excel report to email',
                  'Draft professional email with key insights and schedule meeting'
                ],
                content: 'Hi! I need to create our quarterly sales report pulling data from Salesforce and analyzing it in Excel. Can you guide me through the complete workflow?'
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
        content: "I'll help you create a comprehensive quarterly sales report! This will involve pulling data from Salesforce, analyzing it in Excel, and emailing the results. Let's start by logging into Salesforce to export your Q4 sales data."
      }
    ]
  },
  {
    task_prompt: 'Research competitor pricing and create comparison presentation for client meeting',
    apps_used: [
      { name: 'Chrome', domain: 'desktop', description: 'Web research across multiple sites' },
      { name: 'Google Docs', domain: 'docs.google.com', description: 'Research notes and data collection' },
      { name: 'PowerPoint', domain: 'desktop', description: 'Presentation creation' },
      { name: 'Teams', domain: 'desktop', description: 'Schedule client meeting' }
    ],
    conversation: [
      {
        role: 'user',
        content: 'Task: Research competitor pricing and create comparison presentation for client meeting\nApps: Chrome (desktop app), Google Docs (web: docs.google.com), PowerPoint (desktop app), Teams (desktop app)'
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
                title: 'Competitive analysis presentation',
                app: 'Chrome, Google Docs, PowerPoint, Teams',
                icon_url: 'https://s2.googleusercontent.com/s2/favicons?domain=google.com&sz=64',
                objectives: [
                  'Launch <app>Chrome</app> browser and open multiple tabs for competitor websites',
                  'Research top 5 competitor pricing pages and capture key information',
                  'Take screenshots of competitor pricing tables for reference',
                  'Open <app>Google Docs</app> in new browser tab',
                  'Create shared document for research notes and data collection',
                  'Organize pricing data in structured format with competitor comparison table',
                  'Add insights and analysis notes about pricing strategies',
                  'Launch <app>PowerPoint</app> desktop application',
                  'Create new presentation with company template',
                  'Import data from Google Docs and add comparison charts',
                  'Design visual slides with competitor pricing analysis',
                  'Add executive summary with recommendations',
                  'Save presentation and export as PDF backup',
                  'Open <app>Teams</app> and schedule client meeting',
                  'Upload presentation to meeting invite and send calendar invite'
                ],
                content: 'Hi! I need to research our competitors and create a pricing comparison presentation for an important client meeting. Can you walk me through this multi-step workflow?'
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
        content: "Perfect! I'll guide you through creating a competitive analysis presentation. We'll research competitor pricing, organize our findings, and create a professional presentation for your client meeting. Let's start by opening Chrome to research your main competitors."
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
You are designing realistic MULTI-APP WORKFLOWS that capture how humans naturally work with computers in ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}. These workflows will be demonstrated through screen recordings to train AI models for authentic computer use - capturing the messy, chaotic reality of human multitasking across applications.

### **CORE PRINCIPLE:** Authentic Human Workflow Chaos
- Model the **non-linear reality** of human computer use - jumping between apps, interrupted workflows, context switching, and parallel tasks
- Each task represents a **complete natural workflow** that humans actually do in real work contexts
- Focus on **organic multi-app sequences**: starting in email, opening attachments, switching to browsers, checking references, returning to documents
- Capture the **authentic messiness**: opening multiple tabs, switching windows, copying data between apps, managing multiple contexts simultaneously

### **CRITICAL: Generate Complete Workflows, Not Micro-Steps**
- **ONE task = ONE complete workflow** that naturally involves multiple applications
- **NO sequential decomposition** - don't break workflows into artificial steps
- **Capture natural flow** where users organically move between apps to accomplish their goal
- **Real-world context** - tasks that professionals actually perform in their daily work

### **${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} Context:**  
- **Platform Diversity**: Seamless mixing of desktop applications, web apps, and system tools
- **Interrupted Workflows**: Real work involves distractions, context switches, and parallel processing
- **Cross-Application Data Flow**: Copy-paste, drag-drop, file sharing, and reference checking across multiple tools

### **Workflow Examples (Complete, Not Sequential Steps):**

#### **GOOD: Complete Multi-App Workflow**
**Task:** "Create quarterly sales report by pulling data from CRM, analyzing in spreadsheet, and presenting findings"
**Natural Flow:** Salesforce web → download CSV → Excel desktop → pivot tables → email client → attach report → schedule meeting → Calendar app → copy meeting link back to email

#### **BAD: Artificial Micro-Steps** 
❌ "Step 1: Open Salesforce and export data"
❌ "Step 2: Import data into Excel" 
❌ "Step 3: Create pivot tables"
❌ "Step 4: Email the report"

#### **GOOD: Natural Chaos Examples**
- "Research and write blog post about industry trends" → Browser research → multiple tabs → bookmark tools → Google Docs → fact-checking → image search → document formatting → publishing platform → social media scheduling
- "Prepare presentation for client meeting" → email thread review → attachment downloads → file organization → PowerPoint → web research → screenshot tools → design feedback via Slack → calendar scheduling → meeting link sharing
- "Process customer support tickets" → ticketing system → knowledge base lookup → email client → screen sharing tool → CRM updates → follow-up scheduling → team chat notifications  

### **Output Format (JSON object):**  
{
  "name": "Workflow Collection Name",
   "tasks": [
        {
          "task_name": "Task Name",
          "prompt": "Complete natural workflow request that involves multiple apps organically",
          "categories": ["category1", "category2"],
          "apps_used": [
            {
              "name": "App Name 1", 
              "domain": "app1.com", // for web apps, or "desktop" for native apps
              "description": "Role in this workflow"
            }, 
            {
              "name": "App Name 2", 
              "domain": "desktop", // or actual domain for web apps  
              "description": "Role in this workflow"
            },
            {
              "name": "App Name 3",
              "domain": "app3.com", 
              "description": "Role in this workflow"
            }
            // Include ALL apps that are naturally used in this complete workflow
          ]
        }
        // Generate 5-10 DIFFERENT complete workflows, not sequential steps
      ]
}

### **CRITICAL INSTRUCTIONS:**

1. **Map skills to COMPLETE workflows** - Don't create artificial step-by-step decompositions
2. **Each task = ONE realistic professional workflow** that naturally involves multiple apps
3. **Capture authentic chaos** - the messiness of real work where people jump between apps contextually
4. **Focus on organic multi-app flow** - how professionals actually work, not idealized processes
5. **Generate 2-4 different complete workflows** per skill set, each involving different app combinations

### **Real-World Workflow Categories:**
- **Research & Analysis**: Web research + Document creation + Data analysis + Communication
- **Content & Communication**: Social monitoring + Writing + Design + Publishing + Team coordination  
- **Data & Reporting**: Data collection + Spreadsheet work + Visualization + Presentation + Distribution
- **Development & Technical**: Code editing + Testing + Documentation + Version control + Collaboration
- **Operations & Management**: Email processing + Calendar management + File organization + Team communication
- **Creative & Media**: Asset gathering + Design tools + Content creation + Review cycles + Publishing

**CRITICAL**: Analyze the provided skills and create workflows that ACTUALLY USE those specific skills in realistic professional contexts. For "copy info from excel to word" → Generate ONE task like "Create quarterly budget summary by extracting financial data from multiple Excel reports and formatting into executive presentation" that naturally involves Excel → data manipulation → Word → formatting → email → calendar scheduling.

**AVOID**: Breaking natural workflows into artificial sequential micro-steps. Each task should be a complete, realistic professional workflow.

<SKILLS>
{skill list}
</SKILLS>

Output only the JSON object with no additional text or explanation.`
