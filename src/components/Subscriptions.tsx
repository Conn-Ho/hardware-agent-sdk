import { useNavigate } from 'react-router-dom';
import { Check, CircleNotch, Sparkle } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useManageSubscription,
  useSubscriptionService,
  useTokenPackPurchase,
} from '@/services/subscriptionService';
import { useTokenPacks } from '@/hooks/useTokenPacks';

interface PricingTier {
  name: string;
  description: string;
  oldPrice?: string;
  price: string;
  features: string[];
  buttonText: string;
  popular?: boolean;
  lookupKey: string;
}

const freePlan: PricingTier = {
  name: 'Free',
  description: 'Get started for free',
  price: '0',
  features: ['50 tokens per day', 'All AI features', 'Community support'],
  buttonText: 'Current Plan',
  lookupKey: 'free',
};

const standardFeatures = [
  '1,000 tokens per month',
  'All AI features',
  'Buy additional token packs',
];

const proFeatures = [
  '5,000 tokens per month',
  'Phone number of founders',
  'Exclusive access to new features',
  'Good vibes',
];

const yearlyPricingTiers: PricingTier[] = [
  freePlan,
  {
    name: 'Pro',
    description: 'For power users',
    oldPrice: '29.99',
    price: '17.99',
    features: proFeatures,
    buttonText: 'Get Pro',
    popular: true,
    lookupKey: 'pro_yearly',
  },
  {
    name: 'Standard',
    description: 'For regular use',
    oldPrice: '9.99',
    price: '5.99',
    features: standardFeatures,
    buttonText: 'Get Standard',
    lookupKey: 'standard_yearly',
  },
];

const monthlyPricingTiers: PricingTier[] = [
  freePlan,
  {
    name: 'Pro',
    description: 'For power users',
    price: '29.99',
    features: proFeatures,
    buttonText: 'Get Pro',
    popular: true,
    lookupKey: 'pro_monthly',
  },
  {
    name: 'Standard',
    description: 'For regular use',
    price: '9.99',
    features: standardFeatures,
    buttonText: 'Get Standard',
    lookupKey: 'standard_monthly',
  },
];

export function Subscriptions() {
  const navigate = useNavigate();
  const { user, subscription } = useAuth();

  const { mutate: handleSubscribeMutation, isPending: isSubscribeLoading } =
    useSubscriptionService();
  const { mutate: handleManageSubscription, isPending: isManageLoading } =
    useManageSubscription();
  const { data: tokenPacks = [] } = useTokenPacks();
  const {
    mutate: purchaseTokenPack,
    isPending: isPurchaseLoading,
    variables: purchaseVariables,
  } = useTokenPackPurchase();

  const handleSubscribe = (lookupKey: string) => {
    if (!user) {
      navigate('/signin');
      return;
    }

    handleSubscribeMutation({ lookupKey, source: 'subscriptions' });
  };

  const renderTiers = (tiers: PricingTier[]) => (
    <div className="flex flex-col items-center gap-4 px-4 md:flex-row md:items-stretch md:justify-center md:px-8">
      {tiers.map((tier) => (
        <SubscriptionCard
          key={tier.name}
          tier={tier}
          isLoading={isSubscribeLoading || isManageLoading}
          onClick={
            subscription === 'free'
              ? () => handleSubscribe(tier.lookupKey)
              : handleManageSubscription
          }
          totalCards={tiers.length}
        />
      ))}
    </div>
  );

  return (
    <div className="min-h-screen w-full bg-adam-bg-secondary-dark">
      <div className="flex min-h-screen w-full flex-col items-center justify-center py-12">
        <div className="w-full max-w-5xl">
          <div className="mb-8 px-8 text-center">
            <h1 className="mb-2 font-kumbh-sans text-3xl font-light text-white">
              Choose a plan that works for you
            </h1>
            <p className="text-sm text-adam-neutral-300">
              All plans include access to every AI feature. Upgrade for more
              tokens.
            </p>
          </div>

          <Tabs
            defaultValue="monthly"
            className="flex w-full flex-col items-center"
          >
            <TabsList className="mb-8 border border-adam-neutral-700 bg-adam-neutral-900">
              <TabsTrigger
                value="monthly"
                className="data-[state=active]:bg-adam-neutral-100 data-[state=active]:text-adam-neutral-900"
              >
                Monthly
              </TabsTrigger>
              <TabsTrigger
                value="yearly"
                className="pr-1.5 data-[state=active]:bg-adam-neutral-100 data-[state=active]:text-adam-neutral-900"
              >
                Annual
                <span className="ml-1.5 rounded-full bg-adam-blue/20 px-2 text-[10px] font-medium text-adam-blue">
                  -40%
                </span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="yearly" className="w-full">
              {renderTiers(yearlyPricingTiers)}
            </TabsContent>
            <TabsContent value="monthly" className="w-full">
              {renderTiers(monthlyPricingTiers)}
            </TabsContent>
          </Tabs>

          {/* Token Packs */}
          {tokenPacks.length > 0 && (
            <div className="mt-12 px-8">
              <div className="mx-auto max-w-2xl text-center">
                <h2 className="mb-2 text-xl font-light text-white">
                  Need more tokens?
                </h2>
                <p className="mb-6 text-sm text-adam-neutral-300">
                  Purchase token packs that never expire. Use them anytime.
                </p>
                <div className="flex flex-wrap justify-center gap-3">
                  {tokenPacks.map((pack) => {
                    const isThisPending =
                      isPurchaseLoading &&
                      purchaseVariables?.lookupKey === pack.stripe_lookup_key;
                    return (
                      <Button
                        key={pack.id}
                        variant="dark"
                        className="rounded-full border border-adam-neutral-700 px-5 font-light"
                        disabled={isPurchaseLoading}
                        onClick={() =>
                          purchaseTokenPack({
                            lookupKey: pack.stripe_lookup_key,
                          })
                        }
                      >
                        {isThisPending && (
                          <CircleNotch className="mr-2 h-4 w-4 animate-spin" />
                        )}
                        {`${pack.token_amount} tokens — $${(pack.price_cents / 100).toFixed(2)}`}
                      </Button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SubscriptionCard({
  tier,
  isLoading,
  onClick,
  totalCards,
}: {
  tier: PricingTier;
  isLoading: boolean;
  onClick: () => void;
  totalCards: number;
}) {
  const { subscription } = useAuth();

  const isCurrent =
    (tier.lookupKey === 'free' && subscription === 'free') ||
    (tier.name === 'Pro' && subscription === 'pro') ||
    (tier.name === 'Standard' && subscription === 'standard');

  return (
    <Card
      className={cn(
        'relative flex w-full flex-col border bg-adam-neutral-950 transition-all duration-200',
        totalCards === 2 ? 'md:max-w-[340px]' : 'md:max-w-[300px]',
        tier.popular
          ? 'border-adam-blue/50 bg-adam-blue/[0.04] shadow-[0_0_40px_-8px_rgba(0,166,255,0.2)]'
          : 'border-adam-neutral-800',
      )}
    >
      {tier.popular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="flex items-center gap-1 rounded-full bg-adam-blue px-3 py-1 text-xs font-medium text-white">
            <Sparkle className="h-3 w-3" />
            Most Popular
          </span>
        </div>
      )}

      <CardHeader className="pb-2 pt-6">
        <div className="mb-1 text-sm font-medium text-adam-neutral-300">
          {tier.name}
        </div>
        <div className="flex items-baseline gap-1">
          {tier.oldPrice && (
            <span className="text-sm text-adam-neutral-500 line-through">
              ${tier.oldPrice}
            </span>
          )}
          <span className="text-4xl font-light text-white">${tier.price}</span>
          <span className="text-sm text-adam-neutral-400">/mo</span>
        </div>
        <p className="mt-1 text-xs text-adam-neutral-400">{tier.description}</p>
      </CardHeader>

      <CardContent className="flex-1 pb-4 pt-4">
        <ul className="flex flex-col gap-2.5">
          {tier.features.map((feature) => (
            <li key={feature} className="flex items-start gap-2.5">
              <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-adam-blue" />
              <span className="text-sm text-adam-neutral-200">{feature}</span>
            </li>
          ))}
        </ul>
      </CardContent>

      <CardFooter className="pb-6 pt-2">
        {isCurrent ? (
          <Button
            className="h-10 w-full rounded-full bg-adam-neutral-800 text-sm font-medium text-adam-neutral-400"
            disabled
          >
            Current Plan
          </Button>
        ) : tier.lookupKey === 'free' && subscription !== 'free' ? (
          <Button
            className="h-10 w-full rounded-full bg-adam-neutral-800 text-sm font-medium text-adam-neutral-200 hover:bg-adam-neutral-700"
            onClick={() => onClick()}
          >
            Manage Plan
          </Button>
        ) : (
          <Button
            className={cn(
              'h-10 w-full rounded-full text-sm font-medium transition-all',
              tier.popular
                ? 'bg-adam-blue text-white hover:bg-adam-blue/90'
                : 'bg-adam-neutral-100 text-adam-neutral-900 hover:bg-white',
            )}
            onClick={() => onClick()}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <CircleNotch className="mr-2 h-4 w-4 animate-spin" />
                Loading...
              </>
            ) : subscription !== 'free' ? (
              'Manage Plan'
            ) : (
              tier.buttonText
            )}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
