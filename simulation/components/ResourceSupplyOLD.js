function ResourceSupply() {}

ResourceSupply.prototype.Schema =
	"<a:help>Provides a supply of one particular type of resource.</a:help>" +
	"<a:example>" +
		"<Amount>1000</Amount>" +
		"<MaxAmount>1500</MaxAmount>" +
		"<Type>food.meat</Type>" +
		"<KillBeforeGather>false</KillBeforeGather>" +
		"<MaxGatherers>25</MaxGatherers>" +
		"<DiminishingReturns>0.8</DiminishingReturns>" +
		"<Change>" +
			"<Growth>" +
				"<Constraint>Alive</Constraint>" +
				"<Value>2</Value>" +
				"<Interval>1000</Interval>" +
			"</Growth>" +
			"<Decay>" +
				"<Constraint>Dead</Constraint>" +
				"<Value>-1</Value>" +
				"<Interval>1000</Interval>" +
				"<Delay>2000</Delay>" +
			"</Decay>" +
		"</Change>" +
        "<Renewable>false</Renewable>" +
	"</a:example>" +
	"<element name='KillBeforeGather' a:help='Whether this entity must be killed (health reduced to 0) before its resources can be gathered'>" +
		"<data type='boolean'/>" +
	"</element>" +
	"<element name='Amount' a:help='Amount of resources available from this entity'>" +
		"<choice><data type='nonNegativeInteger'/><value>Infinity</value></choice>" +
	"</element>" +
	"<optional>" +
		"<element name='MaxAmount' a:help='The max amount of resource the entity can reach when growing'>" +
			"<ref name='nonNegativeDecimal'/>" +
		"</element>" +
	"</optional>" +
    "<optional>" +
      "<element name='Renewable' a:help='Whether this resource is to be left alone(entity not removed) after it&quot;s resource supply is used up'>" +
        "<data type='boolean' />" +
      "</element>" +
    "</optional>" +
	"<element name='Type' a:help='Type and Subtype of resource available from this entity'>" +
		Resources.BuildChoicesSchema(true, true) +
	"</element>" +
	"<element name='MaxGatherers' a:help='Amount of gatherers who can gather resources from this entity at the same time'>" +
		"<data type='nonNegativeInteger'/>" +
	"</element>" +
	"<optional>" +
		"<element name='DiminishingReturns' a:help='The relative rate of any new gatherer compared to the previous one (geometric sequence). Leave the element out for no diminishing returns.'>" +
			"<ref name='positiveDecimal'/>" +
		"</element>" +
	"</optional>" +
	"<optional>" +
		"<element name='Change' a:help='Optional element for defining whether a resource supply would regenerate when it&quot;s not gathered'>" +
			"<zeroOrMore>" +
				"<element a:help='Optional element for defining whether a resource supply would regenerate when it&quot;s not gathered'>" +
					"<anyName />" +
					"<interleave>" +
						"<optional>" +
							"<element name='Constraint' a:help='Specifies the terrain type restriction for this building.'>" +
								"<choice>" +
									"<value>Alive</value>" +
									"<value>Dead</value>" +
									"<value>Both</value>" +
								"</choice>" +
							"</element>" +
						"</optional>" +
						"<optional>" +
							"<element name='Delay' a:help='Delay in milliseconds before the object starts growing or decaying'>" +
								"<ref name='nonNegativeDecimal'/>" +
							"</element>" +
						"</optional>" +
						"<element name='Value' a:help='The amount of resource added per interval'>" +
							"<data type='decimal'/>" +
						"</element>" +
						"<element name='Interval' a:help='The interval in milliseconds'>" +
							"<data type='nonNegativeInteger'/>" +
						"</element>" +
					"</interleave>" +
				"</element>" +
			"</zeroOrMore>" +
		"</element>" +
	"</optional>";

ResourceSupply.prototype.Init = function()
{
	// Current resource amount (non-negative)
	this.amount = +this.template.Amount;
	this.maxAmount = this.amount;
	if (this.template.MaxAmount && +this.template.MaxAmount > this.amount)
		this.maxAmount = +this.template.MaxAmount;

	this.infinite = !isFinite(+this.template.Amount);

	if (this.template.Change && !this.infinite)
		for (let key in this.template.Change)
			this.AddRegenTimer(this.template.Change[key], key);

	// List of IDs for each player
	this.gatherers = [];
	let numPlayers = Engine.QueryInterface(SYSTEM_ENTITY, IID_PlayerManager).GetNumPlayers();
	for (let i = 0; i < numPlayers; ++i)
		this.gatherers.push([]);

	let [type, subtype] = this.template.Type.split('.');
	this.cachedType = { "generic": type, "specific": subtype };
    this.renewable = this.template.Renewable;
//    this.renewable = true;
};

ResourceSupply.prototype.GetRenewable = function()
{
    return this.renewable == "true";
}
ResourceSupply.prototype.IsInfinite = function()
{
	return this.infinite;
};

ResourceSupply.prototype.GetKillBeforeGather = function()
{
	return this.template.KillBeforeGather == "true";
};

ResourceSupply.prototype.GetMaxAmount = function()
{
	return this.maxAmount;
};

ResourceSupply.prototype.GetCurrentAmount = function()
{
	return this.amount;
};

ResourceSupply.prototype.GetMaxGatherers = function()
{
	return +this.template.MaxGatherers;
};

ResourceSupply.prototype.GetNumGatherers = function()
{
	return this.gatherers.reduce((a, b) => a + b.length, 0);
};

/* The rate of each additionnal gatherer rate follow a geometric sequence, with diminishingReturns as common ratio. */
ResourceSupply.prototype.GetDiminishingReturns = function()
{
	if ("DiminishingReturns" in this.template)
	{
		let diminishingReturns = ApplyValueModificationsToEntity("ResourceSupply/DiminishingReturns", +this.template.DiminishingReturns, this.entity);
		if (diminishingReturns)
		{
			let numGatherers = this.GetNumGatherers();
			if (numGatherers > 1)
				return diminishingReturns == 1 ? 1 : (1 - Math.pow(diminishingReturns, numGatherers)) / (1 - diminishingReturns) / numGatherers;
		}
	}
	return null;
};

ResourceSupply.prototype.SetAmount = function(newAmount)
{
	let oldAmount = this.amount;
	this.amount = Math.min(Math.max(newAmount, 0), this.GetMaxAmount());
	this.UpdateSupplyStatus(oldAmount);
};

ResourceSupply.prototype.TakeResources = function(amount)
{
	// Before changing the amount, activate Fogging if necessary to hide changes
	let cmpFogging = Engine.QueryInterface(this.entity, IID_Fogging);
	if (cmpFogging)
		cmpFogging.Activate();

	if (this.infinite)
		return { "amount": amount, "exhausted": false };

	let oldAmount = this.amount;
	this.SetAmount(oldAmount - amount);

	return { "amount": oldAmount - this.amount, "exhausted": this.amount == 0 };
};

ResourceSupply.prototype.GetType = function()
{
	// All resources must have both type and subtype
	return this.cachedType;
};

ResourceSupply.prototype.IsAvailable = function(player, gathererID)
{
	return this.amount > 0 && (this.GetNumGatherers() < this.GetMaxGatherers() || this.gatherers[player].indexOf(gathererID) !== -1);
};

ResourceSupply.prototype.AddGatherer = function(player, gathererID)
{
	if (!this.IsAvailable(player, gathererID))
		return false;

	if (this.gatherers[player].indexOf(gathererID) === -1)
	{
		this.gatherers[player].push(gathererID);
		// broadcast message, mainly useful for the AIs.
		Engine.PostMessage(this.entity, MT_ResourceSupplyNumGatherersChanged, { "to": this.GetNumGatherers() });
	}

	return true;
};

// should this return false if the gatherer didn't gather from said resource?
ResourceSupply.prototype.RemoveGatherer = function(gathererID, player)
{
	if (player != undefined && player != INVALID_PLAYER)
	{
		let index = this.gatherers[player].indexOf(gathererID);
		if (index !== -1)
		{
			this.gatherers[player].splice(index, 1);
			// broadcast message, mainly useful for the AIs.
			Engine.PostMessage(this.entity, MT_ResourceSupplyNumGatherersChanged, { "to": this.GetNumGatherers() });
		}
	}
	// This can happen if the unit is dead
	else
		for (let i = 0; i < this.gatherers.length; ++i)
			this.RemoveGatherer(gathererID, i);
};

ResourceSupply.prototype.AddRegenTimer = function(change, key)
{
	let cmpTimer = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer);
	if (!this.regenTimers)
		this.regenTimers = {};

	if (!this.regenTimers[key])
	{
		let changeWithName = { "Name" : key}
		for (let attribute in change)
			changeWithName[attribute] = change[attribute];

		this.regenTimers[key] = cmpTimer.SetInterval(this.entity, IID_ResourceSupply, "RegenSupply", change.Delay ? +change.Delay : +change.Interval, +change.Interval, changeWithName);
	}
};

ResourceSupply.prototype.RegenSupply = function(change)
{
	let cmpHealth = Engine.QueryInterface(this.entity, IID_Health);
	if (change.Constraint &&
	    (change.Constraint == "Alive" && !cmpHealth ||
	    change.Constraint == "Dead" && cmpHealth))
		return;

	this.SetAmount(this.amount + ApplyValueModificationsToEntity("ResourceSupply/Change/" + change.Name + "/Value", +change.Value, this.entity));
};

ResourceSupply.prototype.UpdateSupplyStatus = function(oldAmount)
{
	// Remove entities that have been exhausted.
    var renewable = this.GetRenewable();
	if (this.amount == 0 && !renewable)
		Engine.DestroyEntity(this.entity);

	// Do not send messages if the resource count didn't change.
	if (oldAmount != this.amount)
		Engine.PostMessage(this.entity, MT_ResourceSupplyChanged, {
			"from": oldAmount,
			"to": this.amount
		});
};

ResourceSupply.prototype.OnDestroy = function()
{
	let cmpTimer = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer);
	if (!this.regenTimers)
		return;

	for (let key in this.regenTimers)
		cmpTimer.CancelTimer(this.regenTimers[key]);
};

Engine.RegisterComponentType(IID_ResourceSupply, "ResourceSupply", ResourceSupply);
