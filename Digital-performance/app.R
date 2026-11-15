# =====================================================================
# HYSSOP DIGITAL PERFORMANCE - DASHBOARD v2
# Reads the computed tabs written by Code.gs. It never calculates scores itself,
# so the spreadsheet, the forms and this dashboard always agree.
#
# Install once:
#   install.packages(c("shiny","shinydashboard","googlesheets4","dplyr","tidyr",
#                      "ggplot2","DT","scales"))
# Run locally (interactive Google sign-in):   shiny::runApp()
# Deploy: set HYSSOP_SA_JSON to a service-account key path (see README).
# =====================================================================

library(shiny)
library(shinydashboard)
library(googlesheets4)
library(dplyr)
library(tidyr)
library(ggplot2)
library(DT)
library(scales)

SHEET_ID <- Sys.getenv("HYSSOP_SHEET_ID", "1z-jMr2A4bwBECrihgoZUCPdM7XYOnek2Wn0SiJSdN_8")
key_json <- Sys.getenv("HYSSOP_SA_JSON")

# Private sheet: authenticate with a service account (shared with the spreadsheet as Viewer).
# Never make the sheet public: it holds lead records.
if (nzchar(key_json)) {
  key_file <- tempfile(fileext = ".json")
  writeLines(key_json, key_file)
  gs4_auth(path = key_file)
} else {
  stop("Set the HYSSOP_SA_JSON environment variable to the service-account key contents.")
}

SCORECARDS <- c("Faith", "Chege", "Derrick", "Dan - Ads", "Dan - Website", "Marketing Coordinator")

# ---------- helpers ----------
num  <- function(x) suppressWarnings(as.numeric(gsub("[,%]", "", as.character(x))))
pdate <- function(x) as.Date(as.character(x), tryFormats = c("%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y"))
pct  <- function(n, d) if (isTRUE(d > 0)) paste0(round(100 * n / d, 1), "%") else "0%"

# Read a tab as text. A missing or empty tab returns an empty table instead of failing.
read_tab <- function(tab) {
  x <- tryCatch(read_sheet(SHEET_ID, sheet = tab, col_types = "c"), error = function(e) NULL)
  if (is.null(x)) tibble() else as_tibble(x)
}

# Make sure the columns exist (an empty tab has none), so the tidy step never fails.
ensure <- function(x, cols) {
  for (cc in cols) if (!cc %in% names(x)) x[[cc]] <- character(nrow(x))
  x
}

clean_weekly <- function(x) x %>%
  ensure(c("Week Starting (Monday)", "Program Month", "Scorecard Key", "Row Type", "KPI", "Category", "Unit",
           "Scoring Direction", "Monthly Target (ref)", "Weekly Committed", "Weekly Actual",
           "Delivery % (capped at 120)", "Status")) %>%
  transmute(Week = pdate(`Week Starting (Monday)`), Month = num(`Program Month`),
            Scorecard = `Scorecard Key`, Type = `Row Type`, KPI = KPI, Category = Category, Unit = Unit,
            Direction = `Scoring Direction`, `Monthly target` = num(`Monthly Target (ref)`),
            Committed = num(`Weekly Committed`), Actual = num(`Weekly Actual`),
            Delivery = num(`Delivery % (capped at 120)`), Status = Status)

clean_summary <- function(x) x %>%
  ensure(c("Week Starting (Monday)", "Scorecard Key", "KPIs committed", "KPIs reported",
           "KPIs at or above 100%", "Commitment delivery % (reported KPIs)")) %>%
  transmute(Week = pdate(`Week Starting (Monday)`), Scorecard = `Scorecard Key`,
            Committed = num(`KPIs committed`), Reported = num(`KPIs reported`),
            `At or above 100%` = num(`KPIs at or above 100%`),
            Delivery = num(`Commitment delivery % (reported KPIs)`))

clean_monthly <- function(x) x %>%
  ensure(c("Program Month", "Scorecard Key", "Leads and site visits (%)", "Reach and brand growth (%)",
           "Engagement (%)", "Process discipline (%)", "Lead handoff (%)", "Influencer and collaboration (%)",
           "Branding assets and sales materials (%)", "Campaign and content execution (%)",
           "Reporting and events (%)", "Total score (out of 100)", "Band", "KPIs with no data")) %>%
  transmute(Month = num(`Program Month`), Scorecard = `Scorecard Key`,
            `Leads & site visits` = num(`Leads and site visits (%)`),
            `Reach & brand` = num(`Reach and brand growth (%)`),
            Engagement = num(`Engagement (%)`),
            `Process discipline` = num(`Process discipline (%)`),
            `Lead handoff` = num(`Lead handoff (%)`),
            `Influencer & collab` = num(`Influencer and collaboration (%)`),
            `Brand & sales materials` = num(`Branding assets and sales materials (%)`),
            `Campaign & content` = num(`Campaign and content execution (%)`),
            `Reporting & events` = num(`Reporting and events (%)`),
            Total = num(`Total score (out of 100)`), Band = Band,
            `KPIs with no data` = num(`KPIs with no data`))

clean_mkpi <- function(x) x %>%
  ensure(c("Program Month", "Scorecard Key", "KPI", "Category", "Unit", "Scoring Direction",
           "Monthly Target", "Actual (month)", "Attainment % (capped at 120)", "Status")) %>%
  transmute(Month = num(`Program Month`), Scorecard = `Scorecard Key`, KPI = KPI, Category = Category,
            Unit = Unit, Direction = `Scoring Direction`, Target = num(`Monthly Target`),
            Actual = num(`Actual (month)`), `Attainment %` = num(`Attainment % (capped at 120)`),
            Status = Status)

# Leads: personal data (names and phone numbers) is deliberately NOT carried into the dashboard.
clean_leads <- function(x) x %>%
  ensure(c("Lead Date", "Lead Source", "Assigned Agent", "Scorecard Owner", "Qualified?",
           "Contacted within 15 minutes?", "Handoff to agent within 15 min?", "Site Visit Status",
           "Sale Status", "Sale Value (KES)", "Plots Sold", "Duplicate of earlier lead?")) %>%
  transmute(Date = pdate(`Lead Date`), Source = `Lead Source`, Agent = `Assigned Agent`,
            Owner = `Scorecard Owner`, Qualified = `Qualified?`, Contact15 = `Contacted within 15 minutes?`,
            Handoff15 = `Handoff to agent within 15 min?`, Visit = `Site Visit Status`,
            Sale = `Sale Status`, Value = num(`Sale Value (KES)`), Plots = num(`Plots Sold`),
            Duplicate = `Duplicate of earlier lead?`)

ui <- dashboardPage(
  dashboardHeader(title = "Hyssop Digital Performance"),
  dashboardSidebar(
    selectInput("month", "Program month", choices = c(1, 2, 3), selected = 1),
    sidebarMenu(
      menuItem("Executive summary", tabName = "exec", icon = icon("dashboard")),
      menuItem("Monthly scorecards (A)", tabName = "monthly", icon = icon("trophy")),
      menuItem("Weekly commitments (B)", tabName = "weekly", icon = icon("balance-scale")),
      menuItem("Leads and sales", tabName = "leads", icon = icon("users")),
      menuItem("Data health", tabName = "health", icon = icon("stethoscope")),
      menuItem("Approved KPI library", tabName = "library", icon = icon("list"))
    )
  ),
  dashboardBody(
    tags$head(tags$style(HTML(".content-wrapper,.right-side{background:#f3f6fa}.box{border-radius:8px}"))),
    textOutput("stamp"),
    tabItems(
      tabItem(tabName = "exec",
        fluidRow(valueBoxOutput("v_leads", 3), valueBoxOutput("v_qual", 3),
                 valueBoxOutput("v_visits", 3), valueBoxOutput("v_won", 3)),
        fluidRow(valueBoxOutput("v_plots", 3), valueBoxOutput("v_value", 3),
                 valueBoxOutput("v_dan", 3), valueBoxOutput("v_flags", 3)),
        fluidRow(box(title = "Score by scorecard (selected month, out of 100)", width = 7,
                     plotOutput("p_scores", height = 320)),
                 box(title = "Bands (85+ bonus-eligible, 70-84 on track, below 70 coaching)", width = 5,
                     DTOutput("t_bands")))),
      tabItem(tabName = "monthly",
        fluidRow(box(title = "Monthly scorecard: category attainment (%) and total", width = 12,
                     DTOutput("t_monthly"))),
        fluidRow(box(title = "KPI detail against approved monthly targets", width = 12,
                     selectInput("kpi_key", "Scorecard", choices = c("All", SCORECARDS)),
                     DTOutput("t_mkpi")))),
      tabItem(tabName = "weekly",
        fluidRow(box(title = "Commitment delivery by week (measure B, kept separate from the approved scorecard)",
                     width = 12, plotOutput("p_delivery", height = 300), DTOutput("t_summary"))),
        fluidRow(box(title = "Weekly commitment against actual, by KPI", width = 12,
                     selectInput("w_key", "Scorecard", choices = c("All", SCORECARDS)),
                     DTOutput("t_weekly")))),
      tabItem(tabName = "leads",
        fluidRow(valueBoxOutput("v_qual_rate", 4), valueBoxOutput("v_visit_rate", 4),
                 valueBoxOutput("v_conv_rate", 4)),
        fluidRow(box(title = "Lead funnel", width = 4, plotOutput("p_funnel", height = 280)),
                 box(title = "Sales by source", width = 4, plotOutput("p_sources", height = 280)),
                 box(title = "Performance by agent", width = 4, DTOutput("t_agents")))),
      tabItem(tabName = "health",
        fluidRow(box(title = "Data health checks (errors that affect scores appear here)", width = 12,
                     DTOutput("t_health")))),
      tabItem(tabName = "library",
        fluidRow(box(title = "Company-approved KPI library (read-only)", width = 12, DTOutput("t_library"))))
    )
  )
)

server <- function(input, output, session) {
  tick <- reactiveTimer(120000)   # refresh every 2 minutes
  D <- reactive({
    tick()
    list(weekly = read_tab("WEEKLY_KPI_RESULTS"), summary = read_tab("WEEKLY_SUMMARY"),
         mkpi = read_tab("MONTHLY_KPI_RESULTS"), monthly = read_tab("MONTHLY_SCORECARD"),
         health = read_tab("DATA_HEALTH"), leads = read_tab("LEADS_REGISTER"),
         library = read_tab("KPI_LIBRARY"))
  })
  W <- reactive(clean_weekly(D()$weekly))
  S <- reactive(clean_summary(D()$summary))
  M <- reactive(clean_monthly(D()$monthly))
  MK <- reactive(clean_mkpi(D()$mkpi))
  # Counted leads only: duplicates are excluded here, as they are in the scoring engine.
  L <- reactive(clean_leads(D()$leads) %>% filter(!grepl("^Yes", Duplicate)))
  MONTH <- reactive(as.numeric(input$month))

  output$stamp <- renderText(paste("Refreshed", format(Sys.time(), "%d %b %Y %H:%M"),
                                   "| The spreadsheet recalculates scores after every save."))

  # ----- executive -----
  output$v_leads <- renderValueBox(valueBox(nrow(L()), "Leads counted", icon = icon("users"), color = "blue"))
  output$v_qual <- renderValueBox(valueBox(pct(sum(L()$Qualified == "Qualified", na.rm = TRUE), nrow(L())),
                                           "Qualified share", icon = icon("check"), color = "green"))
  output$v_visits <- renderValueBox(valueBox(sum(L()$Visit == "Completed", na.rm = TRUE), "Site visits completed",
                                             icon = icon("map-marker"), color = "yellow"))
  output$v_won <- renderValueBox(valueBox(sum(L()$Sale == "Won", na.rm = TRUE), "Sales won",
                                          icon = icon("trophy"), color = "purple"))
  output$v_plots <- renderValueBox(valueBox(sum(L()$Plots, na.rm = TRUE), "Plots sold",
                                            icon = icon("th-large"), color = "green"))
  output$v_value <- renderValueBox(valueBox(paste("KES", comma(sum(L()$Value[L()$Sale == "Won"], na.rm = TRUE))),
                                            "Won sale value", icon = icon("money"), color = "yellow"))
  output$v_dan <- renderValueBox({
    x <- M() %>% filter(Month == MONTH(), Scorecard == "Dan (combined 70/30)")
    val <- if (nrow(x) && !is.na(x$Total[1])) paste0(round(x$Total[1], 1), " / 100") else "No data"
    valueBox(val, "Dan combined score (70% Ads, 30% Website)", icon = icon("line-chart"), color = "teal")
  })
  output$v_flags <- renderValueBox({
    h <- D()$health
    n <- if (nrow(h)) sum(h$Check != "All checks passed", na.rm = TRUE) else 0
    valueBox(n, "Open data-health items", icon = icon("stethoscope"), color = if (n > 0) "red" else "green")
  })
  output$p_scores <- renderPlot({
    x <- M() %>% filter(Month == MONTH(), !is.na(Total))
    validate(need(nrow(x) > 0, "No scores yet for this month. Save weekly actuals to see scores."))
    ggplot(x, aes(reorder(Scorecard, Total), Total, fill = Band)) +
      geom_col() + geom_hline(yintercept = c(70, 85), linetype = "dashed", colour = "grey40") +
      coord_flip() + theme_minimal() + labs(x = NULL, y = "Score (out of 100)", fill = NULL) +
      theme(legend.position = "bottom")
  })
  output$t_bands <- renderDT({
    x <- M() %>% filter(Month == MONTH()) %>% select(Scorecard, Total, Band, `KPIs with no data`)
    datatable(x, rownames = FALSE, options = list(dom = "t", pageLength = 10))
  })

  # ----- monthly (measure A) -----
  output$t_monthly <- renderDT(datatable(M(), rownames = FALSE, options = list(pageLength = 20, scrollX = TRUE)))
  output$t_mkpi <- renderDT({
    x <- MK() %>% filter(Month == MONTH())
    if (input$kpi_key != "All") x <- x %>% filter(Scorecard == input$kpi_key)
    datatable(x, rownames = FALSE, filter = "top", options = list(pageLength = 20, scrollX = TRUE))
  })

  # ----- weekly commitments (measure B) -----
  output$p_delivery <- renderPlot({
    x <- S() %>% filter(!is.na(Delivery), !is.na(Week))
    validate(need(nrow(x) > 0, "No weekly commitments with actuals yet."))
    ggplot(x, aes(Week, Delivery, colour = Scorecard, group = Scorecard)) +
      geom_line() + geom_point() + theme_minimal() +
      labs(x = NULL, y = "Commitment delivery (%)", colour = NULL) + theme(legend.position = "bottom")
  })
  output$t_summary <- renderDT(datatable(S(), rownames = FALSE, options = list(pageLength = 15, scrollX = TRUE)))
  output$t_weekly <- renderDT({
    x <- W()
    if (input$w_key != "All") x <- x %>% filter(Scorecard == input$w_key)
    datatable(x, rownames = FALSE, filter = "top", options = list(pageLength = 20, scrollX = TRUE))
  })

  # ----- leads -----
  output$v_qual_rate <- renderValueBox(valueBox(pct(sum(L()$Qualified == "Qualified", na.rm = TRUE), nrow(L())),
                                                "Qualified share", color = "green"))
  output$v_visit_rate <- renderValueBox(valueBox(pct(sum(L()$Visit == "Completed", na.rm = TRUE), nrow(L())),
                                                 "Lead-to-visit (completed)", color = "aqua"))
  output$v_conv_rate <- renderValueBox(valueBox(pct(sum(L()$Sale == "Won", na.rm = TRUE), nrow(L())),
                                                "Lead-to-sale conversion", color = "purple"))
  output$p_funnel <- renderPlot({
    validate(need(nrow(L()) > 0, "No leads recorded yet."))
    z <- data.frame(Stage = factor(c("Leads", "Qualified", "Visit completed", "Won"),
                                   levels = c("Leads", "Qualified", "Visit completed", "Won")),
                    Count = c(nrow(L()), sum(L()$Qualified == "Qualified", na.rm = TRUE),
                              sum(L()$Visit == "Completed", na.rm = TRUE), sum(L()$Sale == "Won", na.rm = TRUE)))
    ggplot(z, aes(Stage, Count, fill = Stage)) + geom_col(show.legend = FALSE) + theme_minimal()
  })
  output$p_sources <- renderPlot({
    validate(need(nrow(L()) > 0, "No leads recorded yet."))
    z <- L() %>% group_by(Source) %>% summarise(Won = sum(Sale == "Won", na.rm = TRUE), .groups = "drop")
    ggplot(z, aes(reorder(Source, Won), Won)) + geom_col(fill = "#18864b") + coord_flip() + theme_minimal() +
      labs(x = NULL, y = "Sales won")
  })
  output$t_agents <- renderDT({
    x <- L() %>% group_by(Agent) %>%
      summarise(Leads = n(), Qualified = sum(Qualified == "Qualified", na.rm = TRUE),
                Visits = sum(Visit == "Completed", na.rm = TRUE), Won = sum(Sale == "Won", na.rm = TRUE),
                Plots = sum(Plots, na.rm = TRUE), `Value (KES)` = sum(Value[Sale == "Won"], na.rm = TRUE),
                .groups = "drop")
    datatable(x, rownames = FALSE, options = list(dom = "t", pageLength = 15))
  })

  # ----- data health and library -----
  output$t_health <- renderDT(datatable(D()$health, rownames = FALSE, options = list(pageLength = 25, scrollX = TRUE)))
  output$t_library <- renderDT(datatable(D()$library, rownames = FALSE, options = list(pageLength = 25, scrollX = TRUE)))
}

shinyApp(ui, server)
